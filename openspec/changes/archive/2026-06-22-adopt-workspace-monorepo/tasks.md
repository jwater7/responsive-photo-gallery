## 1. Workspace root + member manifests

- [x] 1.1 Add a root `package.json`: `private: true`, `workspaces: ["gallery", "enrichment", "packages/*"]`, no app dependencies or entrypoints.
- [x] 1.2 Confirm each member has its own `package.json` (gallery, enrichment, packages/config, packages/jwt-user-auth, packages/fast-image-processing).
- [x] 1.3 Decide frontend placement (default: `gallery/frontend/`) and record it.

## 2. Relocate the gallery app into `gallery/`

- [x] 2.1 `git mv` the gallery sources under `gallery/`: `app.js`, `bin/`, `routes/`, `handlers/`, `lib/`, `views/`, `public/`, `test/`, `scripts/`, `package.json`.
- [x] 2.2 `git mv frontend/` to its chosen location (default `gallery/frontend/`).
- [x] 2.3 Fix any `__dirname`/relative path references broken by the move (notably `app.js` serving `frontend/build`).

## 3. Convert cross-package links to workspace resolution

- [x] 3.1 In `gallery/package.json`, reference `rpg-config`, `jwt-user-auth`, `fast-image-processing` as workspace deps (drop `file:` specifiers).
- [x] 3.2 In `enrichment/package.json`, reference `rpg-config` as a workspace dep (drop `file:../packages/config`).
- [x] 3.3 In `packages/jwt-user-auth/package.json`, reference `rpg-config` as a workspace dep (drop `file:../config`).
- [x] 3.4 Run a fresh root `npm install`; verify `require('rpg-config')` resolves from both gallery and enrichment natively.

## 4. Gallery image + tooling

- [x] 4.1 Rewrite `Dockerfile` (gallery) for the workspace-root context with a scoped install (gallery member + its workspace deps only; no enrichment deps).
- [x] 4.2 Update `.dockerignore` / add a per-image ignore so the gallery context excludes `enrichment/` and unrelated members but includes its workspace deps.
- [x] 4.3 Update `scripts/check-gallery-isolation.js` scan roots to the relocated gallery paths; confirm it still flags a planted enrichment import.
- [x] 4.4 Update all gallery npm scripts (paths to `debug-data`, `bin/www`, `frontend`) and any root-level convenience scripts.

## 5. Enrichment image — remove the stopgap

- [x] 5.1 Rewrite `enrichment/Dockerfile` for the workspace-root context with a scoped install (`--workspace=enrichment`); ensure rpg-config resolves via workspace linking.
- [x] 5.2 Remove the stopgap `npm install --prefix /packages/config` line.
- [x] 5.3 Update `enrichment/Dockerfile.dockerignore` for the new install layout.

## 6. Deployment wiring

- [x] 6.1 Update `docker-compose.yml` build stanzas (context/dockerfile) for both enrichment services and the gallery if its context changes.
- [x] 6.2 Mirror the build-stanza updates in `debug-data/example-prod-docker-compose.yml` (gitignored; edit on disk, do not commit).
- [x] 6.3 Confirm runtime bind mounts + env are unaffected (they target in-container `/data/*` paths).

## 7. Verify

- [x] 7.1 `npm install` at root succeeds; workspace links present for all members.
- [x] 7.2 All three suites green: `rpg-config`, gallery (incl. isolation guard), enrichment.
- [x] 7.3 Build the gallery image; assert enrichment-only deps are absent.
- [x] 7.4 Build the enrichment image; assert gallery-only deps are absent and `require('rpg-config')` resolves at runtime (fail-open `[]`).
- [x] 7.5 Confirm container entrypoints unchanged (`node ./bin/www`, `node src/bin/server.js`, `node src/bin/worker.js`).
- [x] 7.6 `docker compose config -q` passes.
