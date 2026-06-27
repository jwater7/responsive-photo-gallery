## ADDED Requirements

### Requirement: Single workspace root with relocated gallery

The repository root SHALL be a private, application-less npm-workspaces manifest
whose members are `gallery`, `enrichment`, and `packages/*`. The gallery application
SHALL live under `gallery/` (not the repo root), and the `frontend/` it builds and
serves SHALL move with it. Cross-package dependencies (`rpg-config`, `jwt-user-auth`,
`fast-image-processing`) SHALL be resolved through workspace linking rather than
`file:` path specifiers.

#### Scenario: Shared package resolves in native dev

- **WHEN** a developer runs a fresh `npm install` at the repo root and then runs any
  member (gallery or enrichment)
- **THEN** `require('rpg-config')` resolves and loads its transitive dependencies
  (`debug`, `node-json-db`) without any `file:`-path or `--prefix` workaround

#### Scenario: Root manifest carries no application code

- **WHEN** the root `package.json` is inspected
- **THEN** it declares `workspaces` and `private: true` and contains no gallery
  application dependencies or entrypoints (those live in `gallery/package.json`)

### Requirement: Lean, scoped per-service images

Each service Docker image SHALL install only its own workspace dependency closure.
The gallery image SHALL NOT contain the enrichment plane's dependencies, and the
enrichment image SHALL NOT contain the gallery's dependencies. Both images SHALL
build from the workspace-root context using a scoped install
(`npm install --workspace=<member>`).

#### Scenario: Gallery image excludes enrichment deps

- **WHEN** the gallery image is built and its installed modules are inspected
- **THEN** enrichment-only packages (e.g. `@huggingface/transformers`, `bullmq`,
  `meilisearch`) are absent

#### Scenario: Enrichment image excludes gallery deps

- **WHEN** the enrichment image is built and its installed modules are inspected
- **THEN** gallery-only packages (e.g. `passport`, `fast-image-processing`) are absent

### Requirement: Shared packages resolve in every image without patching

Shared workspace packages SHALL resolve at runtime in every built image purely via
workspace linking. The stopgap in-place install
(`npm install --prefix /packages/config`) in `enrichment/Dockerfile` SHALL be
removed.

#### Scenario: Enrichment worker loads rpg-config in-image

- **WHEN** the enrichment image runs `node` and requires `rpg-config` (directly or via
  `src/lib/walk-dir.js`)
- **THEN** it loads successfully and `loadExcludes()` returns `[]` (fail-open) when no
  excludes file is mounted

#### Scenario: No per-image resolution workaround remains

- **WHEN** `enrichment/Dockerfile` is inspected
- **THEN** it contains no `npm install --prefix /packages/config` line and no
  equivalent per-image dependency patch

### Requirement: Isolation, degradation, and entrypoints preserved

The relocation SHALL preserve the existing guarantees. The gallery hot path SHALL NOT
import the enrichment plane (the isolation guard SHALL pass against the new paths),
the gallery SHALL continue to operate when the enrichment plane is unreachable, the
existing container entrypoints SHALL be unchanged, and all current test suites SHALL
remain green.

#### Scenario: Isolation guard passes under the new layout

- **WHEN** the isolation guard runs after the move
- **THEN** it scans the relocated gallery `routes/`, `handlers/`, `lib/`, `app.js`,
  and `bin/www` and reports no enrichment-plane imports

#### Scenario: Entrypoints unchanged

- **WHEN** the gallery, enrichment indexer, and enrichment worker containers start
- **THEN** they run `node ./bin/www`, `node src/bin/server.js`, and
  `node src/bin/worker.js` respectively, exactly as before the move

#### Scenario: Test suites stay green

- **WHEN** the `rpg-config`, gallery (including isolation), and enrichment test suites
  run after the restructure
- **THEN** all three pass with no regressions
