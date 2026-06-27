## Why

The shared `rpg-config` package (CONFIG_PATH, node-json-db config stores, auth-path
+ migration, the directory-exclude contract) is now a dependency of the gallery,
`jwt-user-auth`, and the enrichment worker. The gallery resolves it cleanly because
it lives under the repo root; the enrichment image does not — it vendors the package
as a **sibling** of `/app` (`file:../packages/config`), so npm's hoisted deps
(`debug`, `node-json-db`) are unreachable from the package's real path. We shipped a
**stopgap** (`npm install --prefix /packages/config` in `enrichment/Dockerfile`) to
make it resolve. The durable fix is a real npm-workspaces monorepo, where workspaces
are the resolution mechanism and no per-image patching is needed.

## What Changes

- **BREAKING (repo layout):** Move the gallery application out of the repo root into
  `gallery/` — `app.js`, `bin/`, `routes/`, `handlers/`, `lib/`, `views/`, `public/`,
  `test/`, `scripts/`, `package.json`, and the `frontend/` it builds and serves.
- Make the **repo root** a private, app-less **workspace manifest** with members
  `gallery`, `enrichment`, and `packages/*`.
- Convert the cross-package links (`rpg-config`, `jwt-user-auth`,
  `fast-image-processing`) from `file:` specifiers to workspace resolution.
- Rewrite **both Dockerfiles** to build from the workspace root with **scoped**
  installs (`npm install --workspace=…`) so each image installs only its own
  dependency closure — the gallery image must not pull enrichment deps, and vice
  versa.
- Update `docker-compose.yml` (+ the gitignored example-prod compose) build contexts,
  all npm scripts (paths to `debug-data`, `bin/www`, `frontend`), the isolation guard
  `scripts/check-gallery-isolation.js` (scan roots), and `.dockerignore` /
  `.gitignore`.
- **Remove the stopgap** `npm install --prefix /packages/config` line from
  `enrichment/Dockerfile`.

## Capabilities

### New Capabilities
- `workspace-monorepo`: How the repository is structured as an npm-workspaces
  monorepo — the workspace root and members, how shared packages are resolved across
  all build artifacts (native dev + both Docker images), the requirement that
  per-service images stay lean (no cross-service dependency bleed), and the
  preservation of the gallery↔enrichment import-isolation guard and graceful
  degradation under the new layout.

### Modified Capabilities
<!-- None: the gallery's runtime behavior, the deployment topology, and the dev
     runtime modes are unchanged at the requirement level. This change relocates
     code and rewires builds; the observable build/deploy/dev outcomes that change
     (lean scoped images, workspace-resolved shared packages) are captured by the
     new `workspace-monorepo` capability above. -->

## Impact

- **Repo structure:** gallery app relocated root → `gallery/`; `frontend/` moves with
  it. Largest churn surface — nearly every gallery path reference shifts.
- **Build/CI:** `Dockerfile` (gallery) and `enrichment/Dockerfile` rewritten for a
  workspace-root context + scoped installs; `.dockerignore` per-image filters updated.
- **Tooling:** root + member `package.json` files; npm scripts; the isolation guard's
  scan roots.
- **Deployment:** `docker-compose.yml` and `debug-data/example-prod-docker-compose.yml`
  build stanzas (runtime bind mounts / env are unaffected — they target in-container
  `/data/*` paths).
- **Must preserve:** the import-isolation guard (gallery never imports the enrichment
  plane), graceful degradation when enrichment is down, the three green test suites
  (`rpg-config`, gallery + isolation, enrichment), and the current Docker image
  entrypoints (`node ./bin/www`, `node src/bin/server.js`, `node src/bin/worker.js`).
