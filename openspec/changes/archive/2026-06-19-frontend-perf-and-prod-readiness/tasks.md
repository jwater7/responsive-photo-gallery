## 1. Stage 1 — Security hardening (apply to current deploy now)

- [x] 1.1 Replace hardcoded cookie secret `'TODO Needs a Secret'` (`app.js:38`): generate a strong (256-bit) secret on first run and persist it in the jwt-user-auth config DB (`auth.db` `/cookieSecret`), like the JWT `privateKey` — not an env var
- [x] 1.2 Remove the insecure `:-masterKey` Meili default. Decided keyless: Meili has no host ports and is reached only by the indexer on the internal network (indexer's `meiliApiKey` defaults to `""`), so no master key is supplied or generated — keeps the prod compose self-contained (no CLI env / `.env`). Dropped all three `MEILI_MASTER_KEY` lines; gallery app's vestigial `MEILI_*` removed
- [x] 1.3 Remove host-published datastore ports (Meili `7700`, Mongo `27017`) so they are internal-network only (verified native dev only re-publishes `:8080`); same applied to the prod compose (`example-prod-docker-compose.yml` Mongo `27021`)
- [x] 1.4 Enable `Secure` cookies: add `trust proxy` (`TRUST_PROXY` env) so the existing `secure: req.secure` engages behind a TLS proxy; pin `jwtCookieSecure: true` (signed-cookie read). Verified `Secure` appears only with forwarded HTTPS; set `TRUST_PROXY=true` in the prod compose
- [x] 1.5 Verified login/ping/logout end-to-end on the dev server: login 200 + signed HttpOnly cookie, ping-with-cookie 200, ping-without 401, logout 200; `cookieSecret` generated & persisted

## 2. Stage 2 — Vendor fold-in (the enabler)

- [x] 2.1 Added `packages/` in-tree location; `package.json` consumes `file:packages/*`; `Dockerfile` copies `packages/` before `npm install`
- [x] 2.2 Vendored `fast-image-processing` verbatim via `git archive` @ abff938 (v0.0.5) → `file:packages/fast-image-processing` (own commit, diffable)
- [x] 2.3 Vendored `jwt-user-auth` verbatim via `git archive` @ 27b4e9d (v0.0.3) → `file:packages/jwt-user-auth` (own commit, diffable)
- [x] 2.4 Verified flows unchanged after the verbatim copies: thumbnail + `/list` metadata (fast-image-processing) and login/ping/bad-login (jwt-user-auth). NOTE: surfaced a pre-existing Node-25 landmine (jsonwebtoken→buffer-equal-constant-time uses removed `SlowBuffer`); fixed with a `buffer.SlowBuffer` shim in `app.js` (own commit; no-op on Docker LTS)
- [x] 2.5 Widened `jwt-user-auth` generated key `randomBytes(3*4)`→`randomBytes(32)` (256-bit; also the default admin password); `PRIVATE_KEY`/DB precedence + HS256 compat preserved; verified fresh init yields 32-byte key
- [x] 2.6 Added `buildSpriteSheet(cells, opts, dest)` (sharp `.composite()` grid; returns per-cell geometry) — async/await
- [x] 2.7 Added `buildCollage(cells, opts, dest)` (cover montage; rescales rendered cells, no source re-decode)
- [x] 2.8 `renderCell(src, size)` decodes each source once → cell buffer + oriented dims + EXIF capture date (single pass); throws per-cell on unsupported inputs so the build pass can skip
- [x] 2.9 Archived the upstream `fast-image-processing` and `jwt-user-auth` GitHub repos (done by the user 2026-06-18; in-tree `packages/*` are now the source of truth)

## 3. Stage 3 — Album build engine (backend)

- [x] 3.1 Defined `CACHE_PATH/<album>/` layout (`cover.jpg`, `sprites/<group>-<n>.jpg`, `manifest.json`) + manifest schema (`albumHash`, groups+labels, sheets w/ `srcHash`, cells w/ image + sprite coords + oriented dims). NOTE: lives in a **new** `handlers/album-build.js`, not `image-handler.js` (keeps new async/await code out of the legacy callback module)
- [x] 3.2 Implemented `buildAlbum`: walk media files, `renderCell` once each → EXIF month bucket + dims + cell, pack sheets, compose cover, temp-dir + atomic rename, manifest written last; unrenderable files skipped
- [x] 3.3 Per-album single-flight (`inFlight` map); concurrent cold requests share one build
- [x] 3.4 **Automatic rebuild-on-change is DONE** (not deferred): every request recomputes the whole-album hash (md5 over each file's `name:size:mtime`); unchanged → serve cache, changed (add/remove/edit/rename/touch) → rebuild automatically. DEFERRED is only the *efficiency* of the rebuild: per-sheet `srcHash` is recorded so a future **incremental append** can re-decode only changed/new images and reuse unchanged sheets — today a detected change does a (correct) full rebuild
- [x] 3.5 Build + serving are filesystem-only (no enrichment-DB dependency); browsing works when the enrichment plane is down
- [x] 3.6 `GET /api/v1/album-manifest?album=` (200 current / 202 + build when cold/stale), under auth
- [x] 3.7 `GET /api/v1/album-cover` + `GET /api/v1/album-sprite?sheet=` serve cached JPEGs with cache headers (path-confined)
- [x] 3.8 Cold/stale manifest request returns `202` and triggers the build (non-blocking)
- [x] 3.9 `GET /api/v1/album-status?album=` → `{ state, done, total, sheetsReady }` (reports ready off disk after restart)
- [x] 3.10 Backend verified end-to-end (direct + via server): cold→202, poll building→ready, manifest 200, cover/sprite served, cache-hit on re-request, 401 unauthenticated

## 4. Stage 4 — Frontend re-architecture & migration gaps

- [x] 4.1 `components/SpriteGrid.js` renders fixed square cells from the manifest via the percentage-background technique (each cell a sprite-sheet crop; responsive at any column count)
- [x] 4.2 Reworked `pages/album.js` to consume the manifest/sheets (no `/list` full metadata); shows a build progress bar while cold. NOTE: renders the full grid once ready (per-sheet progressive render not done — partial manifests aren't exposed; progress bar covers the "still building" UX)
- [x] 4.3 Pinch-zoom changes column count + CSS only (percentage cells, one sheet resolution); plus −/+ zoom buttons
- [x] 4.4 Lightbox opens full-size, aspect-correct (oriented dims from manifest), preserving the enrichment overlay (`MetaLightbox`) + inline ★ favorite toggle
- [x] 4.5 Home `AlbumElement` shows a responsive cover grid drawn from an even-sampled cover sprite sheet (cells in the manifest; one request/album); adapts to viewport via CSS, whole-row capped; removed `use-thumbs`. (Sprite sheets are content-addressed `<srcHash>.jpg` — no date/filename coupling.)
- [x] 4.6 GAP 1: skip-to-month group buttons (`scrollIntoView` via refs) driven by manifest groups
- [x] 4.7 GAP 3: deep-link — open the lightbox from `?image=` and write the viewed image back to the URL (replaceState)
- [x] 4.8 GAP 2: dead `/collection/<album>` link removed (album.js rewrite)
- [x] 4.9 GAP 4: `pages/404.js` custom not-found page
- [~] 4.10 Verified headless: static export builds clean (all 9 routes); pages serve (`/home/`, `/album/`, `/404.html` → 200); `album-tags` favorites round-trip; manifest/cover/sprite/status endpoints drive the view. **Live browser visual check (grid/zoom/lightbox/deep-link interaction) still recommended**

## 5. Stage 5 — Production deployment

- [x] 5.1 Convert `Dockerfile` to multi-stage: build the static frontend export in a build stage; runtime stage serves `frontend/build` with no build toolchain; drop `CMD build-frontend && start`. NOTE: Next freezes `PUBLIC_URL`/`NEXT_PUBLIC_*` at build (confirmed against the Next 16 env-vars docs; `output:export` has no runtime server to re-read them), so to keep the app's **three independent base-path knobs runtime-configurable** in one prebuilt image, the export bakes **three distinct sentinels** — `PUBLIC_URL`→`/__RPG_ASSET_BASE__` (Next basePath: asset/router URLs), `NEXT_PUBLIC_BASENAME`→`/__RPG_APP_BASENAME__` (router basename + login cookie path), `NEXT_PUBLIC_API_PREFIX`→`/__RPG_API_PREFIX__` (API endpoint, may be a different path/origin) — and `docker-entrypoint.sh` rewrites each from its own env var at container start (a text substitution, not a build), honoring the original `lib/api.js` fallback chain (BASENAME/API default to PUBLIC_URL). **Empirically verified all three bake intact** on this Next 16 + Turbopack export (assets 179, basename 6, api 6; no fragmentation); entrypoint warns loudly on a fresh container if the sentinels ever stop baking. Three stages: frontend export → backend deps (sharp/vips toolchain isolated) → runtime (`ffmpeg`+`vips` runtime libs only). Dropped `VOLUME /data`/`/images` (compose defines mounts); `.dockerignore` now excludes `frontend/build`, `ocr`, `debug-data`, `openspec`, `.git`
- [x] 5.2 Removed the unused Mongo service + its `/data/db` mount from `docker-compose.yml`, dropped `DBHOST` from app env, and removed `rpg-mongodb` from the `dev:deps` npm script; prod example (`debug-data/example-prod-docker-compose.yml`) Mongo service + `DBHOST` removed too
- [x] 5.3 Added healthchecks: app (`wget` root → index.html 200), indexer (`curl /health`), redis (`redis-cli ping`); Meili already had one. `restart: unless-stopped` on app + indexer. `depends_on` gated on `service_healthy` for indexer→{meili,redis} (the real boot race). NOTE: app→indexer kept at `service_started` (NOT healthy) on purpose — the gallery runs in degraded mode when enrichment is down, so it must not be blocked from booting by an unhealthy indexer
- [x] 5.4 Persisted `thumbs`, `tags`, `auth`, the new `/data/cache` sprite tree, `meili`, `redis` on **durable host bind mounts** rather than Docker named volumes — per user preference (they prune volumes regularly; bind mounts survive that and satisfy the "state survives recreation" intent). Existing paths kept: app state under `./debug-data/*`, datastores + cache under `./data/*`
- [x] 5.5 Set `deploy.resources.limits` on the app service (`cpus: "2.0"`, `memory: 2g`, `reservations.memory: 512m`) so a cold-album build (sharp + ffmpeg, alongside the enrichment container's CLIP) can't exhaust the host
- [x] 5.6 Added a "Production deployment" section to the README (self-contained secrets, reverse-proxy/TLS + `TRUST_PROXY`, the `PUBLIC_URL` base-path knob + optional overrides + proxy prefix-stripping, host bind-mount state + backup, app resource limits, `debug` logging); fixed stale Mongo mentions in the compose section
- [x] 5.7 Verified: `docker compose config` publishes only the app's `3000` (no Meili/Redis/indexer host ports; Mongo gone, 4 services). Built the multi-stage image (`docker build`, exit 0) and ran it: runtime layer has **no build toolchain** (`next`/gcc/g++/make/python3 absent; only `ffmpeg` + `libvips.so.42`), the frontend is **prebuilt** (`frontend/build/index.html` present, 179 baked sentinels), and **no `next build` runs at boot** (just `node ./bin/www`). Sentinel rewrite confirmed both ways: `PUBLIC_URL=/photos` → served HTML references `/photos/_next/…`, 0 residual sentinels, HTTP 200; `PUBLIC_URL=/` → `/_next/…`, 0 sentinels, 200. Booted self-contained with **no secrets supplied** (cookie/JWT auto-generated). NOTE: did not run a full `docker compose up` of the enrichment plane (CLIP model bake is heavy) — gallery-side hardening is verified and the gallery serves in degraded mode without enrichment; full-stack bring-up left as the operator's final smoke test

## 6. Wrap-up

- [x] 6.1 `npm test` (isolation check) passes: "gallery isolation verified (9 files scanned, no enrichment-plane imports)". `npm run eslint` is pre-existing-broken and unrelated to this change: ESLint 9.6 wants a flat `eslint.config.js` but the repo still uses the legacy `eslintConfig` package.json key; running in compat mode (`ESLINT_USE_FLAT_CONFIG=false`) surfaces 962 pre-existing `prettier/prettier` style violations across the repo. Stage 5 touched only Docker/compose/shell/docs (no backend JS), so introduced no lint regressions; the ESLint-9 migration + repo reformat is separate tech debt, intentionally not done here
- [x] 6.2 Updated the explore doc header to "SHIPPED" (points at the change's tasks.md as source of truth; notes the only-manual remainder 2.9 and the deferred follow-ups in design.md) and refreshed the [[explore-perf-prod-readiness]] memory to shipped state (Stages 1–6, 40/42)
