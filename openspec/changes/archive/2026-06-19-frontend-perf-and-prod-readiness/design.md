## Context

The gallery is an Express backend that serves images off a read-only filesystem
(`IMAGE_PATH`) plus a static-exported Next.js frontend on the same origin. A
derived-artifact FS cache already exists: `/image?thumb=WxH` and `/thumbnails`
call `fast-image-processing.cacheThumbAndGetBuffer()`, which resizes once and
serves the cached file thereafter (`THUMB_PATH/<album>/<WxH>/<image>`). The only
scaling lever today is `num_results` + `distributed` (even sampling) on `/list`
and `/thumbnails`; there is no pagination, no date filter, and `/album` uses
neither — it pulls full per-file metadata (an expensive `getMetadata` decode per
file) and renders every thumbnail and a full-album lightbox array. Home is fine
(it samples), the album page is the bottleneck.

Two of the user's libraries are consumed as pinned GitHub deps:
`fast-image-processing` (sharp + exif-reader + fluent-ffmpeg; single `index.js`)
and `jwt-user-auth` (jsonwebtoken + node-json-db; single `index.js`). The image
library already composites (sharp `.composite()`) and reads EXIF — everything the
sprite/collage work needs — so folding it in-tree is the natural enabler.

The deployment shipped in `docker-compose.yml` is explicitly a dev/debug stack
(service `rpg-app-local`, `./debug-data/` bind mounts, frontend built at container
start, `MEILI_MASTER_KEY:-masterKey`, host-published Mongo:27017 and Meili:7700).
The real prod compose (`debug-data/example-prod-docker-compose.yml`) confirms a
Mongo is wired via `DBHOST` that **no app code reads** (grep-confirmed vestigial).

This is the umbrella change decided in `openspec/explore/frontend-perf-and-prod-
readiness.md`: ship migration-finish + perf re-architecture + prod hardening as one
staged change. The in-progress `image-enrichment-platform` change stays separate.

## Goals / Non-Goals

**Goals:**
- Album view scales to thousands of images with smooth scroll and bounded server
  decode cost (decode each image once, at build time, not per scroll request).
- Cold albums show real build progress, not a hang; warm albums load from FS cache.
- Browsing works purely off the FS cache; the enrichment DB only enriches.
- A deployment that is safe to expose: no default secrets, datastores off the host
  network, TLS, reproducible multi-stage image, durable volumes, resource limits.
- Close the visible migration gaps (skip-to-month, deep-link, 404, dead link).

**Non-Goals:**
- Changing the enrichment plane's behavior or the `image-enrichment-platform` change.
- Background/cron pre-building. Builds are request-triggered with progress.
- Keeping the justified `RowsPhotoAlbum` rows in the album grid (we accept a fixed
  square-cell grid for sprite-friendliness; lightbox stays aspect-correct).
- A structured-logging migration. Prod logging stays on `debug` for now (no logger
  package exists to vendor — earlier notes speculated one; resolved: there is none).
- Server-side auth/session redesign beyond widening the JWT key.

## Decisions

### D1 — Vendor both libraries in-tree, two stages each
Move `fast-image-processing` and `jwt-user-auth` from `github:jwater7/*` deps into
in-tree packages (e.g. `packages/<name>/`), referenced via `file:`/workspace. **Per
package: first commit is a verbatim copy** (so a diff proves it identical to v0.0.5
/ v0.0.3), **then a second commit modifies.** Rationale: the fold-in is the enabler
for sprite/collage primitives and the only safe place to widen the JWT key; staging
copy-then-modify keeps the vendoring auditable. Upstream GitHub repos are archived
once in-tree is source of truth. Alternative (keep as git deps, patch via fork):
rejected — keeps the indirection and can't host new primitives cleanly.

### D2 — New build primitives live in `fast-image-processing`
Add `buildSpriteSheet()` and `buildCollage()` next to `cacheThumbAndGetBuffer()`,
built on the sharp pipeline already in the module (`.composite()` for packing
cells/montage; `exif-reader` for capture date in the same decode). Rationale: one
decode per image yields date + dims + resized cell + collage tile together. The
handler (`image-handler.js`) orchestrates the per-album walk and cache writes; the
library owns the pixel ops.

### D3 — Cache layout and the build pass
```
/data/cache/<album>/cover.jpg                 ← collage of all images (home)
/data/cache/<album>/sprites/<group>-<n>.jpg   ← date-group sprite sheets (album)
/data/cache/<album>/manifest.json             ← groups, counts, cell→image, dims, hashes
```
`buildAlbum(album)` walks files, decodes each once → EXIF month bucket + dims +
fixed-size cell packed into the current sheet (sharp composite), then composes the
cover. Writes via **atomic temp+rename**. Manifest shape:
`{ albumHash, groups:[{key,label,sheetRange}], sheets:[{n, group, srcHash, cells:[{image,x,y,w,h,oW,oH}]}] }`.
Rationale: extends the existing create-once-if-missing pattern; the manifest is the
single source the frontend needs to map a grid cell → sprite coords → full image.

### D4 — Single-flight + content-hash invalidation
A per-album in-process lock ensures two viewers of a cold album trigger one build.
A whole-album hash (md5 over sorted name+size+mtime) is a fast "anything changed?"
gate; then **per-sheet `srcHash`** decides which sheets rebuild. **New photos append
new sheets** (stable ordering) so trickle-in stays cheap. In-flight locks are lost on
restart (acceptable); the cache is on a persistent volume so completed work survives.
Alternative (whole-album rebuild on any change): rejected — O(album) on every add.

### D5 — Progress protocol: 202 + poll
First request to a cold/stale album returns **`202` with a build id/state**; the
client polls `GET /api/v1/album-status?album=` for `{ state, done, total, sheetsReady }`
and renders sheets as they become listed in the manifest. **Polling over SSE** —
simpler, no long-lived connection through the reverse proxy, matches the existing
request/response API surface. New artifact endpoints (`/api/v1/album-manifest`,
cover/sheet served via the existing `/image`-style cached file route) sit under the
same `/api/v1/*` auth gate and the single same-origin surface. Alternative (SSE/WebSocket):
rejected for proxy simplicity; can revisit if poll latency is felt.

### D6 — Album view: fixed square-cell sprite grid, bake at max zoom
Cells are baked at the **largest zoomed-in display size** (target ~256²) and CSS-
scaled **down** for denser columns (scaling down stays crisp; up blurs). Pinch-zoom
changes **column count + CSS scale only** — one sheet resolution serves all zoom
levels. Mobile-first. The lightbox still renders the full image aspect-correct and
keeps the enrichment-metadata overlay (`MetaLightbox`/`ImageMeta`). Rationale:
sprite packing wants uniform cells; trades the justified layout for density + one
build resolution. Cost: larger sheets — acceptable given "load all in background."

### D7 — Home covers = cached collage of all images
Each album's home preview becomes one cached `cover.jpg` collage (one request/album)
instead of today's `useThumbs` 50-image distributed sample. Home stays N requests for
N albums; "all images, optimized" without a million-thumb page. `AlbumElement` swaps
`useThumbs` for a single cover image; `use-thumbs.js` is retired for this path.

### D8 — Migration gaps
GAP 1 skip-to-month: the album page already wires `saveRefs`; render the per-group
buttons (`scrollIntoView`) driven by the manifest's groups. GAP 2 `/collection`: the
sprite album view **is** the scalable path to full-size images, so **remove the dead
`<Link>`** rather than build a filter page. GAP 3 deep-link: read `?group=&i=` (or
`?image=`) to open the lightbox at a slide and write it back on view. GAP 4: add
`pages/404.js`. Rationale: month grouping now exists only to power skip-to-month.

### D9 — Production hardening
- **Secrets**: the cookie secret (was `app.js:38` hardcoded `'TODO Needs a Secret'`)
  is **generated once and persisted in the jwt-user-auth config DB** under `AUTH_PATH`
  — the same generate-and-persist pattern as the JWT `privateKey` — **not** an env var
  (passing app-owned secrets via env is rejected as insecure). **Meili runs keyless**:
  it has no host ports and is reached only by the indexer on the internal network, and
  the indexer's `meiliApiKey` already defaults to `""`, so the insecure `masterKey`
  default is simply removed (no master key supplied or generated). This also satisfies
  the **self-contained-compose** requirement — `docker compose up` needs no CLI env, no
  `.env`. JWT key widened in-library (D1); `PRIVATE_KEY` still overrides if set.
  (Considered: keep Meili authenticated via a self-generated key shared off its volume —
  rejected as unnecessary mechanism for an internal-only, port-less service.)
- **Network**: drop the **unused Mongo** service entirely (and its accidental
  `/data/db` mount into the app); keep Meili/Redis internal-only (no host ports),
  matching `rpg-ocr-indexer`.
- **TLS**: terminate at a reverse proxy (Caddy/Traefik/nginx); set `Secure` cookies
  (uncomment `jwtCookieSecure`, drive `secure` from `req.secure`/proxy header).
- **Reliability**: healthchecks on app + enrichment; `restart: unless-stopped`;
  `depends_on: { condition: service_healthy }` to kill the boot race.
- **Image**: **multi-stage** Dockerfile — build the static frontend export in a build
  stage; the runtime stage serves `frontend/build` with no toolchain (`vips-dev
  fftw-dev build-base` stay out of runtime). Replaces `CMD build-frontend && start`.
- **Volumes**: named/durable volumes for `thumbs`, `tags`, `auth` (holds the JWT
  key!), the **new `/data/cache` sprite tree**, `meili`, `redis`.
- **Resource limits**: CPU/memory limits on the app so a cold-album build (sharp +
  ffmpeg, alongside CLIP in the enrichment container) can't OOM the host.

## Risks / Trade-offs

- **Cold-album build is CPU/memory heavy (decodes thousands of images)** → single-
  flight lock prevents duplicate builds; resource limits (D9) bound blast radius;
  progress UI (D5) sets user expectations; cache on a persistent volume so a build is
  paid once.
- **Sprite invalidation granularity is subtle** → keep it coarse where safe: whole-
  album hash gate first, per-sheet `srcHash` second, append-only for new photos;
  document that a mid-album deletion may reflow one group's sheets.
- **Baking cells at ~256² inflates sheet bytes** → accepted per "load all in
  background"; revisit cell size / cells-per-sheet if payloads hurt mobile.
- **Vendoring drops upstream version pinning** → mitigated by the verbatim-copy first
  commit (auditable provenance) and archiving the upstream repos to avoid drift.
- **Required-secret enforcement is BREAKING for existing deploys** → call out in the
  change/README; provide a one-time secret-generation note; fail fast with a clear
  message rather than booting insecure.
- **Multi-stage build changes the image contract** → verify the static export serves
  identically same-origin; keep `output: 'export'` + `basePath` behavior intact.
- **Collage legibility for huge albums** (3000 imgs ≈ 12px tiles) → treat the cover as
  a rich texture/teaser, not browsable; the album view is the browse surface. (See
  Open Questions for a possible cap.)

## Migration Plan

Staged within the one change, ordered so each stage is independently shippable:
1. **Prod 🔴 security now** — env-injected cookie/Meili secrets, drop Mongo, internal
   ports, Secure cookies. Applies to the current deploy regardless of B.
2. **Vendor fold-in** — copy-then-modify both libs; widen JWT key; add sprite/collage
   primitives (no behavior change yet). Verify via diff + existing flows.
3. **Build engine** — `buildAlbum`, manifest, single-flight, hash invalidation, status
   + artifact endpoints. Backend testable before any UI.
4. **Frontend** — sprite-grid album view, collage home covers, progress UI, migration
   gaps (skip-to-month, deep-link, 404, remove dead link).
5. **Prod rest** — multi-stage image, healthchecks/restart/ordered start, named volumes
   (incl. `/data/cache`), resource limits sized to stage 3's build pass; prod logging.

**Rollback**: stages 2–4 are additive (new endpoints/cache tree/components); revert the
album-view swap to fall back to the current `use-list` path. Stage 1 and 5 are compose/
Dockerfile changes — roll back by redeploying the previous image/compose.

## Open Questions

- **Cell resolution + cells-per-sheet** concrete numbers (payload vs request-count).
  Lean ~256² cells; sheet cap TBD during stage 3 tuning.
- **Collage look for huge albums**: pure "all images" mosaic vs. a soft cap (e.g. cover
  packs a representative N). User leaned "all images, optimized."
- **Exact `album-status` payload shape** finalized in the `album-build-progress` spec.
- **Manifest cell→image addressing** for deep-link stability across appends (use image
  path as the stable key, not sheet index).

## Deferred Optimizations (follow-ups)

Tracked here so they aren't lost; none affect correctness, only efficiency/scale.

- **Thousands-scale album grid** (decided follow-up, 2026-06-18). The grid currently
  renders *all* cells and the browser pulls essentially all sprite sheets ("load all
  in background"). Fine to a few hundred/album; for thousands add: (1) **virtualize**
  the grid (render only on-screen rows) — the main win; (2) **viewport-lazy sheet
  loading** (fetch only sheets near the scroll position); (3) **trim the manifest**
  (per-cell `w`/`h` always equal `cellSize` — redundant). Home covers already scale
  (fixed 30-sample filmstrip).
- **Incremental sprite append** (§3.4 / D4): per-sheet `srcHash` is recorded but a
  detected change currently triggers a full rebuild; reuse unchanged sheets and only
  re-decode changed/new images.
- **Progressive sheet render during build** (§4.2): expose partial manifests so the
  grid fills in sheet-by-sheet while a cold album builds (today: progress bar, then
  the full grid on ready).
