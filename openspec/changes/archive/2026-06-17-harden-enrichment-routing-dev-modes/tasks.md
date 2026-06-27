# Tasks

Phases 1–3 harden routing/auth and dev modes. Phases 4–5 (added during
implementation) surface the enrichment in the gallery UI and add inline
favoriting, since both ride the now-authenticated `/api/v1/enrich` channel and
the shared lightbox.

## 1. Authenticated enrichment routing

- [x] 1.1 Extract the JWT gate into `lib/require-auth.js` (`(passport) => middleware`, `NO_AUTHENTICATION=yes` → passthrough)
- [x] 1.2 Switch `routes/api.js` to use `requireAuth(passport)` instead of its inline `required`
- [x] 1.3 Mount enrich at `/api/v1/enrich` behind `requireAuth(passport)` in `app.js`; remove the old `/api/enrich` mount (enrich.js stays a plain router)
- [x] 1.4 Update `frontend/lib/enrich-api.js` suffix `api/enrich` → `api/v1/enrich`
- [x] 1.5 Drop the host-published `:8080` on the enrichment service in the default `docker-compose.yml`
- [x] 1.6 Verify `npm run test:isolation` still passes and covers the new mount
- [x] 1.7 Verify: unauthenticated `/api/v1/enrich/*` → 401; authenticated → proxied

## 2. Unify data paths

- [x] 2.1 Point `npm run debug` at the same paths docker-compose uses (`./debug-data/{auth,thumbs,tags}`)
- [x] 2.2 Remove the orphaned `debug-data/data/` nested copy
- [x] 2.3 Verify native and docker-compose runs share auth/thumbs/tags/mongo state

## 3. Single API surface + native/docker dev modes

- [x] 3.1 Keep the single `/api/*` wildcard rewrite as the one dev channel; point it (and `dev:api`) at Express `:8000`; enrich rides it via `/api/v1/enrich`
- [x] 3.2 Add `docker-compose.deps.yml` override that re-publishes the enrichment `:8080` to localhost
- [x] 3.3 Add `dev:deps` script (bring up the four backends)
- [x] 3.4 Add `dev:api` script (`node --watch` Express on `:8000`; debug-data paths; `ENRICH_URL=http://localhost:8080`; auth ON)
- [x] 3.5 Update `frontend` `dev` script for the single-wildcard model; root `dev:ui` runs it (Next `:3000` → Express `:8000`)
- [x] 3.6 Add `dev` script that runs deps + api + ui together
- [x] 3.7 Document both modes (and the per-mode auth posture) in README
- [x] 3.8 Verify wiring: compose merge valid, enrich `:8080` closed by default / re-published by override, auth gate 401↔503, syntax + isolation pass. (Live end-to-end native loop with the built CLIP image not run here — left for a real dev session.)

## 4. Surface enrichment in the gallery UI (additive)

- [x] 4.1 `Home` tab in the navbar (leftmost)
- [x] 4.2 Shared `ImageMeta` panel (AI tags, OCR text, place/coords, taken-date, type/size) as a fading lightbox footer (`useTimedInfo`: shows on view, auto-hides ~2.5s, pinned via an info button)
- [x] 4.3 Shared `MetaLightbox` wrapper (Zoom + Download + info + metadata footer); search & map refactored onto it
- [x] 4.4 Album shows the same panel; fetches its images' enrichment fail-soft, **gated behind the `features` flag** (gallery still works when enrichment is down)
- [x] 4.5 Download button added to the search/map lightboxes
- [x] 4.6 Verify search/map empty only when the index is empty; OCR test image enriched + searchable end-to-end

## 5. Inline favorite editing (replaces the old /edit page)

- [x] 5.1 Inline favorite ★ toggle in the lightbox toolbar (album), via `PATCH /api/v1/image-data { tags }` — optimistic, reverts on failure
- [x] 5.2 Live Favorites section: optimistic SWR `mutate` of the list cache on toggle (no refetch)
- [x] 5.3 Fix backend `mkdirp@3` import (`const { mkdirp } = require('mkdirp')`) so tag writes work; verified symlink create/remove + `list` reflects `favorite`
- [x] 5.4 Controlled lightbox `index` (update on `on.view`) so rebuilding slides on favorite doesn't reset to slide 0
- [x] 5.5 Honest `description` field: read optional sidecar `<file>.txt`, no filename fallback (root-cause fix for the duplicate-caption bug)
