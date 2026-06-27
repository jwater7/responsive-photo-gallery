## Context

The repo currently keeps the gallery Express app **at the repo root**, with
`enrichment/` and `frontend/` as subdirs and three vendored packages under
`packages/` (`config`/rpg-config, `jwt-user-auth`, `fast-image-processing`). Each
service builds a **self-contained image** with its own `npm install`.

The just-shipped `rpg-config` extraction made the gallery, `jwt-user-auth`, and the
enrichment worker all depend on the shared package. npm `file:` deps install as a
symlink; Node resolves a module to its **real path** and searches `node_modules`
upward from there, while npm **hoists** a file: dep's transitive deps into the
*consumer's* `node_modules`. That only works when the package's real path is *under*
the consumer's project root:

- Gallery: rpg-config real path is under the gallery root → hoisted deps reachable. ✅
- Enrichment image: rpg-config is a **sibling** of `/app` (`file:../packages/config`)
  → hoisted deps in `/app/node_modules` are unreachable. ❌ (patched with a stopgap
  `npm install --prefix /packages/config`).

The sibling layout is forced because one `package.json` `file:` spec must satisfy both
native dev (enrichment and packages/ are siblings) and Docker. npm workspaces remove
the `file:`/sibling problem by hoisting all members into one root `node_modules`, but
only if the **repo root is the workspace root** containing every member — which
requires the gallery to stop being the root.

## Goals / Non-Goals

**Goals:**
- Workspaces are the single resolution mechanism; no per-image dependency patching.
- Per-service images stay lean (no cross-service dependency bleed).
- Preserve: import-isolation guard, graceful degradation, the three green suites, and
  the existing container entrypoints.
- Remove the `enrichment/Dockerfile` stopgap.

**Non-Goals:**
- No behavior change to the gallery, enrichment, or the exclude-dirs feature.
- No change to runtime deployment topology (services, ports, bind mounts, env).
- No dependency version bumps beyond what the move mechanically requires.
- Not converting `frontend/` into a published workspace package — it moves under
  `gallery/` and keeps its own build, but is not a shared library.

## Decisions

### Decision: Make the repo root a pure workspace manifest; move the gallery to `gallery/`
The root `package.json` becomes `{ private: true, workspaces: ["gallery", "enrichment", "packages/*"] }`
with no app code. The gallery app (`app.js`, `bin/`, `routes/`, `handlers/`, `lib/`,
`views/`, `public/`, `test/`, `scripts/`, `package.json`) and `frontend/` move under
`gallery/`.
- **Why:** workspaces only help the enrichment image if enrichment is a *member* of a
  workspace root that also contains `packages/*`; that root can only be the repo root;
  the gallery must vacate the root for it to become app-less.
- **Alternatives:** `workspaces: ["packages/*"]` only (gallery stays root) — rejected:
  enrichment sits outside `packages/`, so it can't be a member and the image still
  needs the stopgap. Keeping the stopgap / `--preserve-symlinks` — rejected earlier as
  non-idiomatic patches rather than a real fix.

### Decision: Scoped installs per image from the workspace-root context
Both Dockerfiles build with `context: .` (repo root) and run
`npm install --omit=dev --workspace=<member> [--include-workspace-root]`, copying only
the manifests needed to resolve that member's closure.
- **Why:** a bare root `npm install` installs *all* members (the gallery image would
  pull transformers/onnxruntime, the enrichment image would pull sharp/passport).
  Scoping keeps each image lean.
- **Alternatives:** prune after a full install — slower, larger layers, error-prone.

### Decision: Workspace linking replaces `file:` specifiers
`rpg-config`, `jwt-user-auth`, and `fast-image-processing` are referenced by name (and
resolved as workspaces) instead of `file:` paths.
- **Why:** removes the sibling-resolution failure mode entirely; the hoisted root
  `node_modules` is reachable from every member.

### Decision: Re-root path-coupled tooling
`scripts/check-gallery-isolation.js` scan roots, all npm scripts (paths to
`debug-data`, `bin/www`, `frontend`), `.dockerignore`/`Dockerfile.dockerignore`
filters, and `docker-compose.yml` + the gitignored example-prod compose build stanzas
are updated for the `gallery/` location.
- **Why:** these encode the old root-relative layout; they must track the move or the
  guard/build/dev scripts silently break.

## Risks / Trade-offs

- **Huge diff / path churn across the whole gallery** → Do it as this isolated change
  (no feature mixed in); rely on the three test suites + an actual build of both images
  as the gate; move with `git mv` to preserve history.
- **Gallery Docker build breaks on the workspace declaration (it excludes `enrichment/`)**
  → Use scoped `--workspace` installs and per-image `.dockerignore`s so a missing
  sibling member never has to be installed; verify by building the gallery image.
- **Cross-service dependency bleed via a bare root install** → Always scope installs;
  assert leanness by inspecting installed modules in each image (see specs).
- **Frontend build path drift** (`app.js` serves `frontend/build` via `__dirname`) →
  Move `frontend/` under `gallery/` so the relative path is preserved; re-run the
  frontend build + gallery image build.
- **Isolation guard scanning stale roots** → Update its scan roots and confirm it still
  flags a planted enrichment import.

## Migration Plan

1. Land on a dedicated branch; `git mv` the gallery app + `frontend/` under `gallery/`.
2. Add the root workspace manifest; convert `file:` deps to workspace links.
3. Rewrite both Dockerfiles (root context + scoped installs) and per-image ignores;
   update compose build stanzas, npm scripts, and the isolation guard roots.
4. Remove the `enrichment/Dockerfile` stopgap.
5. Verify: `npm install` at root; all three suites green; build both images; confirm
   leanness + in-image `rpg-config` resolution + unchanged entrypoints.
- **Rollback:** revert the branch; the prior `file:`-based layout (with the stopgap) is
  fully functional and remains the fallback.

## Open Questions

- Is `frontend/` better as `gallery/frontend/` (keeps `app.js` paths intact) or a
  top-level `frontend` workspace member? Default: under `gallery/` to minimize path
  churn; revisit only if we want the frontend independently buildable from the root.
- Exact scoped-install incantation per image (`--workspace` vs
  `--include-workspace-root`, which manifests to COPY for the dependency graph to
  resolve) — settle empirically during implementation against a real build.
