# Exploration: Frontend migration finish · Performance re-architecture · Production readiness

> **Status:** SHIPPED — this exploration became the change
> `openspec/changes/frontend-perf-and-prod-readiness/`, now implemented through
> Stages 1–6 (40/42 tasks). This doc is kept as the historical design record; the
> change's `tasks.md` is the source of truth for what landed.
> **Remaining (not code):** 2.9 archive the upstream `fast-image-processing` /
> `jwt-user-auth` GitHub repos (manual ops action for the user). Deferred
> follow-ups (grid virtualization, incremental sprite append, progressive render)
> are tracked in the change's `design.md`.
> **Last updated:** 2026-06-18. Branch: `ocr`.
>
> **Slicing DECIDED:** shipped all three threads as **one large OpenSpec change**
> with staged tasks (not three separate changes). See §5.

---

## 0. TL;DR

Three intertwined bodies of work emerged:

- **A. Finish the frontend migration** (`frontend-old/` CRA → `frontend/` Next.js).
  A handful of features never made the jump. Small, mostly independent, shippable.
- **B. Performance re-architecture** for scale (hundreds of albums × thousands of
  images each). Pre-computed, FS-cached **collage covers** (home) and
  **date-grouped sprite sheets** (album view), built **on request** with a
  progress channel. Enabled by folding the user's two `jwater7` git deps
  (`fast-image-processing` and `jwt-user-auth`) into a **monorepo** so the
  sprite/montage primitives can be added to the image engine in-tree. (There is
  **no separate "logger" package** — earlier notes speculated one; it doesn't exist.)
- **C. Production hardening.** The current docker-compose is a dev/debug stack;
  needs secrets, internal-only ports, TLS, healthchecks, multi-stage image,
  durable volumes, resource limits, and removal of unused Mongo.

```
dependency: B's monorepo fold-in unblocks B's sprite work.
            C's resource-limits/logging want B's build pass to exist first.
            A is largely independent and shippable on its own.
            C's 🔴 security items apply to the CURRENT deploy — do them anyway.
```

---

## 1. Grounding facts (established by reading the code)

### Lineage
- Original CRA app lived in `frontend/`, was **renamed to `frontend-old/`** at commit
  `3fb6eb6 "moving toward nextjs"`. The current Next.js app was then built in `frontend/`.
- The CRA (`frontend-old/`) was itself **mid-refactor when frozen**: `App.js` /
  `AppMain.js` had most routes commented out, and `Collection.js` had its render
  commented out (a stub). So "the old frontend" is partly *intent* (components that
  exist) rather than fully working screens. The genuinely working features lived in
  `List.js` (PhotoSwipe collections), `Albums`, auth, and favoriting.  If necessary, the fully working "old" frontend can be found in git history.

### Backend API (Express) — `routes/api.js`, `handlers/image-handler.js`
- Endpoints: `/ping /login /logout /albums /list /image /image-data(PATCH) /video /thumbnails`.
  Enrichment proxied behind auth at `/api/v1/enrich` (see archived
  `harden-enrichment-routing-dev-modes` change).
- **Derived-artifact FS cache already exists**: `/image?thumb=WxH` and `/thumbnails`
  call `fast-image-processing.cacheThumbAndGetBuffer()` which writes resized files to
  `THUMB_PATH/<album>/<WxH>/<image>` (and a `/video/` variant) and serves the cache
  thereafter. **This is the "create-once-if-missing-or-get" pattern the new work extends.**
- **Only scaling lever today** = `num_results` + `distributed=true` on `/list` and
  `/thumbnails`. `distributed` does *even sampling* across the album
  (`step = floor(total / num_results)`), see `limitResults()` in
  `handlers/image-handler.js:110`. **There is NO date/collection filter and NO
  offset/cursor pagination.**
- `/list` per file (concurrency 16) runs `getMetadata` (decodes header → dims,
  `modifyDate`, format), reads a `<file>.txt` sidecar description, and `fs.stat`s per
  requested tag. `modifyDate` and `orientedWidth/Height` ONLY come from that expensive
  per-file `getMetadata`. See `handlers/image-handler.js:403-522`.

### Image engine
- `fast-image-processing` (`github:jwater7/fast-image-processing#v0.0.5`) wraps:
  - **`sharp`** → has `.composite()` ⇒ can build sprite sheets AND collage montages natively.
  - **`exif-reader`** → capture dates available in the same decode pass.
  - **`fluent-ffmpeg`** → video thumbnails.
- ⇒ Folding it into the monorepo is the **enabler**: add `buildSpriteSheet()` /
  `buildCollage()` next to `cacheThumbAndGetBuffer()`, on an engine that already
  composites and reads EXIF.  We should do this in two stages, first a direct copy and a commit (for verification thru diff), then modify as needed.

### Auth
- `jwt-user-auth` (`github:jwater7/jwt-user-auth#v0.0.3`). JWT key from
  `PRIVATE_KEY` env, else persisted in its JSON DB under `AUTH_PATH` (`/data/auth`),
  else generated. **Key is only `randomBytes(3*4)` = 96 bits** (`jwt-user-auth/index.js:40-48`).
  Dev uses `PRIVATE_KEY=nonvolatile` (weak).
- Cookie parser secret is hardcoded `'TODO Needs a Secret'` (`app.js:38`).
- `jwtCookieSecure` is commented out (`app.js:50`).

### Serving / build
- Prod Next config (`frontend/next.config.js`) uses `output: 'export'` (static) →
  Express serves `frontend/build` same-origin (`app.js:105`). `rewrites` only apply in
  dev; in prod `/api/*` is same-origin Express. (Good — single origin.)
- Dockerfile builds the frontend **at container startup**:
  `CMD npm run build-frontend && npm start` (`Dockerfile:53`). Single-stage; keeps
  build deps (`vips-dev fftw-dev build-base`) in the runtime image.

---

## 2. Thread A — Finish the frontend migration

### What's already migrated (✅, often improved)
`/albums`→`/home`; `/list/:album` collections → `/album?album=` (same `collectionMap`
grouping, copied into `frontend/data/use-list.js`); PhotoSwipe → `MetaLightbox` (yarl)
with Video+Slideshow+Download; old `/edit` Favorite/Clear → **inline ★ toggle** in the
lightbox (optimistic); old `/singleview` video → Video plugin; auth/login/logout/ping;
landing split → `/` index redirect. Plus **net-new**: `/search`, `/map`, enrichment
metadata overlay (the `ocr` branch work).

### Genuine gaps (old → not in new)
- **GAP 1 — "Skip to month" nav.** Old `List.js` had a button per collection that
  `scrollIntoView`. New `album.js` has the refs wired (`saveRefs`) but the buttons are
  `{/*TODO*/}`. **User confirmed this is wanted** — and it's the *only* reason to keep
  month-grouping at all.
- **GAP 2 — `/collection/[album]` drill-down.** `album.js` `<Link>`s to
  `/collection/${album}?filter=...` but **no such page exists → 404**. Old
  `Collection.js` had `passFilters` (year/month/tags) but its render was commented out.
  **Reframed by user:** this was never really about filtering — it's about a **scalable
  path to the actual full-size images** at thousands-of-images scale. ⇒ Superseded by
  Thread B (sprite grid + lightbox). Action: remove the dead link OR let Thread B's
  album view be the answer.
- **GAP 3 — Deep-link to an image.** Old `List`/`SingleView` restored lightbox open
  state from `?openAtCollection=&startIndex=`. New `album.js` only reads `?album=`.
  No shareable/back-button-to-a-specific-image. (Nice-to-have.)
- **GAP 4 — Custom 404.** Old `NotFound.js`; new relies on Next default.

### Minor shared TODOs (in both, not strictly "old")
- `max_list_items` plumbing (commented in `use-list.js`).
- "sort by modifyDate instead of filename" (TODO in both old & new).

---

## 3. Thread B — Performance re-architecture (the big one)

### Problem
Current `/album` page (`frontend/pages/album.js` + `data/use-list.js`) calls
`list({album})` with **no `num_results`** ⇒ fetches FULL metadata for every file,
renders every thumbnail across every month inline, AND builds a full-album
`fullsizePhotos` lightbox array (+ `geoSearch limit:1000`). Does not scale to thousands.
(`/home` still samples via `useThumbs`, so home is fine; the album page is the problem.)

### Core pattern
Extend the existing FS derived-artifact cache with two new artifacts, built by **one
per-album build pass** that decodes each image once:

```
/data/thumbs/<album>/<WxH>/<image>            ← exists today
/data/cache/<album>/cover.(jpg)               ← NEW collage cover (home)
/data/cache/<album>/sprites/<group>-<n>.jpg   ← NEW date-group sprite sheet (album view)
/data/cache/<album>/manifest.json             ← NEW groups, counts, cell→image map, dims, hashes
```

```
buildAlbum(album)   [single-flight; triggered by request; NOT a background/cron task]
   walk files ─▶ for each (decode once via sharp/exif-reader):
                   • EXIF date → month bucket (for "skip to month")
                   • dims      → manifest
                   • resize to fixed cell → pack into current sprite sheet (sharp.composite)
                 then: compose cover collage
   write sprites/*.jpg, manifest.json, cover.jpg   (atomic rename)
```

### Decisions LOCKED
- **Monorepo fold-in.** Vendor **both** `jwater7` git deps in-tree —
  `fast-image-processing` **and** `jwt-user-auth` — then extend
  `fast-image-processing` with sprite/montage primitives (and widen the JWT key in
  `jwt-user-auth`, see §4🔴). This is the enabler and is low-risk on its own → do it
  first within Thread B. Do it in two stages per package: first a **direct copy +
  commit** (so the vendored code is verifiable as identical via diff), then modify as
  needed. **After vendoring, archive the two GitHub repos** (`github.com/jwater7/
  fast-image-processing`, `github.com/jwater7/jwt-user-auth`) — the monorepo becomes
  the source of truth. (No separate "logger" package exists; nothing else to vendor.)
- **Month grouping exists only to power "skip to month" links** (= GAP 1). Not for filtering.
- **Date source = EXIF**, piggybacked on the build pass's decode (nearly free since we
  decode anyway). (Not FS mtime — mtime is copy-time and wrong.)
- **Build is request-triggered, with a progress channel.** No background/cron worker.
  **First request returns `202 "building"`; frontend polls a status endpoint to drive a
  real progress bar (e.g. "320 / 4000") and renders sheets as they land.** Needs a
  single-flight lock so two viewers of a cold album don't both build.
- **Cache busting via content hash, per-sheet granularity.** A whole-album md5 is just a
  fast "anything changed?" gate; then per-sheet `srcHash` decides which sheets rebuild.
  New photos **append** new sheets (keep ordering stable) so trickle-in stays cheap.
  Manifest carries `{ albumHash, sheets:[{n, srcHash, cells:[…]}], groups }`.
- **Album view = fixed square-cell grid** (sprite-friendly; Google/Apple-Photos style).
  Accept losing the justified `RowsPhotoAlbum` rows for the dense grid; keep
  aspect-correct display in the lightbox.
- **Mobile-first; pinch-zoom changes column count** (bonus). Bake sprite cells at the
  **largest zoomed-in display size** (e.g. ~256²) and CSS-scale down for denser views —
  one sheet resolution serves all zoom levels, only columns + CSS scale change. (Scaling
  down is crisp; scaling up blurs — hence bake at max.) Costs more bytes/sheet; OK given
  "load all in background."
- **Home page** = like today (per-album list), but each album's preview becomes a
  **collage of ALL its images** (one cached request per album) instead of today's
  50-image distributed sample. "All images, optimized" — the collage makes "all"
  affordable. Avoids the "millions on one page" problem; home stays N requests for N albums.
- **Keep all current API endpoints; expand + optimize** (don't replace).
- **FS for browsing, DB for enrichment.** Album browsing must work purely off the FS
  cache; the enrichment DB (Meili) only enriches. Matches existing degraded-mode /
  feature-flag design on the `ocr` branch.
- **Loading strategy:** assume the user will eventually view all images → load sheets in
  the background (not strictly viewport-gated), so scrolling stays smooth.

### Why sprites here (honest rationale)
The HTTP/1-era "fewer requests" benefit is weak under HTTP/2/3. The real win **here** is
moving thumbnail generation from **per-request, on-demand** (server decodes+resizes
thousands of times as users scroll) to **once, at build time**. The bottleneck is
server-side decode cost, not browser request count. Alternative kept in back pocket:
pre-baked individual thumbs + HTTP/2 + virtualized scroll (less build complexity, no
invalidation-granularity problem, keeps justified layout — but eats the first-scroll
thumb-generation stampede).

### Open questions / to discuss further (Thread B)
- ~~Which is the "logger" package?~~ **RESOLVED: there is no logger package.** The
  only `jwater7` git deps are `fast-image-processing` and `jwt-user-auth`; both get
  vendored and both GitHub repos get archived. Prod logging stays on `debug`
  (`DEBUG=responsive-photo-gallery:*`) unless/until replaced — not a vendoring task.
- **Collage legibility for huge albums:** a fixed-canvas "all images" mosaic of 3000
  images = ~12px tiles (texture, not browsable). Confirm intended look (dense mosaic vs.
  a cap). User leaned "all images, optimized," similar to today's strip but richer.
- **Exact status/progress protocol** (`GET /album-status?album=` shape; SSE vs poll;
  partial-sheet streaming render).
- **Cell resolution + cells-per-sheet** concrete numbers (payload vs request-count trade).
- **Single-flight + restart semantics** (in-flight locks lost on restart = acceptable;
  cache on persistent volume so cold-builds aren't repeated).
- **GAP 2 resolution** confirmed: remove the dead `/collection` link in favor of this view?

---

## 4. Thread C — Production hardening

**The current `docker-compose.yml` is a dev/debug stack** (service `rpg-app-local`, all
volumes under `./debug-data/`, frontend built at startup, weak default secrets).

### 🔴 Security — before any public exposure
- Hardcoded cookie secret `'TODO Needs a Secret'` (`app.js:38`) → env-injected strong secret.
- MeiliSearch master key defaults to `masterKey` (`docker-compose.yml:25,42,65`) → require strong key, no default.
- JWT signing key only 96 bits / `PRIVATE_KEY=nonvolatile` (`jwt-user-auth/index.js:40-48`)
  → strong `PRIVATE_KEY`; widen key when vendoring the lib.
- Mongo (27017) + Meili (7700) **published to host** (`docker-compose.yml:71,90-91`) →
  internal network only (ocr-indexer already does this correctly).
- No TLS; 1-yr cookie auth over plain HTTP; `jwtCookieSecure` commented (`app.js:50`) →
  reverse proxy (Caddy/Traefik/nginx) + Secure cookies.

### 🟠 Reliability / operability
- No `restart:` on `rpg-app-local` / `rpg-ocr-indexer` (stateful svcs have it).
- Healthchecks only on Meili; `depends_on` waits for container *start*, not readiness →
  boot race. Add healthchecks + `condition: service_healthy`.
- Frontend built at container startup (`Dockerfile:53`) → slow restarts, build toolchain
  in runtime image, non-reproducible. Move `next build` (static export) into a
  **multi-stage** image build; runtime just serves `frontend/build`.

### 🟡 Hygiene / simplification
- **Mongo is entirely unused** — `DBHOST` set but nothing in app code references
  mongo/mongoose (grep empty). Vestigial → drop the service + the accidental double-mount
  of its data dir into the app container (`docker-compose.yml:11`). Removes a stateful
  service + an open port.
- Single-stage image keeps build deps (`vips-dev fftw-dev build-base`) → multi-stage to trim.
- `build:` in compose → prod should pull tagged images from a registry.
- Bind mounts to `./debug-data/` → prod needs **named volumes + backup** for `thumbs`,
  `tags`, `auth` (holds the JWT key!), the **new sprite cache**, `meili`, `redis`.

### Where Thread B intersects deployment
- New **sprite/collage cache** = another `/data` volume to persist.
- **Request-triggered builds decode thousands of images** (sharp + ffmpeg, alongside
  CLIP in the enrichment container) → set **CPU/memory limits** or a cold-album build can
  OOM the host. **Biggest operational risk the new feature introduces.**
- **Prod logging** currently rides `debug` (`DEBUG=responsive-photo-gallery:*`). No
  logger package exists to vendor; a switch to structured levels would be its own
  task, not part of the fold-in.

---

## 5. Suggested sequencing (instinct, not locked)

1. **Thread C 🔴 security items now** — apply to the current deployment regardless of A/B.
2. **Thread A** — small, independent, shippable anytime (esp. GAP 1 skip-to-month, GAP 4 404).
3. **Thread B** — lead with the monorepo fold-in (enabler, low-risk), then the build pass
   + sprite/collage + request-triggered progress, then home/album UI.
4. **Thread C rest** — multi-stage image, drop Mongo, healthchecks/restart, volumes,
   resource limits (after B's build pass exists, so limits can be sized to it), prod logging.

### How to slice into OpenSpec change(s) — DECIDED: ONE umbrella change
Ship all three threads as **a single large OpenSpec change** with staged tasks
(NOT three separate changes). The sequencing in §5.1–4 becomes the task ordering
within that one change.
- The active change `image-enrichment-platform` stays **separate** and in-progress —
  do NOT fold this work into it.
- Within the umbrella change, the C🔴 security items are still "do now" — they can be
  the first tasks so they land early even though the change as a whole is large.

---

## 6. Key files to reread when resuming

| Area | Files |
|---|---|
| Old features (intent) | `frontend-old/src/components/{List,Collection,Albums,Edit,SingleView}.js`, `frontend-old/src/api.js` |
| New app | `frontend/pages/{home,album,search,map}.js`, `frontend/data/use-list.js`, `frontend/components/{MetaLightbox,ImageMeta,AlbumElement,navbar}.js` |
| Backend cache + scaling | `handlers/image-handler.js` (`limitResults`:110, `list`:403), `routes/api.js` |
| Image engine | `node_modules/fast-image-processing/*` (to be vendored) |
| Auth | `app.js` (cookie:38, jwt:46-55), `node_modules/jwt-user-auth/index.js` |
| Deploy | `docker-compose.yml`, `docker-compose.deps.yml`, `Dockerfile`, `package.json` scripts, `debug-data/example-prod-docker-compose.yml` (real full production configuration being deployed) |
| Related prior work | `openspec/changes/image-enrichment-platform/`, `openspec/changes/archive/2026-06-17-harden-enrichment-routing-dev-modes/` |
