## Why

The Next.js album view doesn't scale: `/album` fetches **full metadata for every
file** and renders **every thumbnail across every month** plus a full-album
lightbox array (`use-list.js` → `list({album})` with no `num_results`), so an
album of thousands of images stalls. At the same time the CRA→Next migration left
a few visible gaps (no "skip to month", a dead `/collection` link that 404s, no
custom 404), and the shipped `docker-compose.yml` is a **dev/debug stack** —
default secrets, host-published datastores, no TLS, frontend built at container
startup — not safe to expose publicly. These are intertwined: the scale fix needs
new server-side build primitives that live in the user's `fast-image-processing`
library, and the production stack must persist and resource-bound the new cache
that fix introduces. Shipping them as one staged change keeps the dependency order
honest (security first, enabler next, then the build engine, UI, and prod stack).

## What Changes

- **Vendor both `jwater7` git deps in-tree** (`fast-image-processing`,
  `jwt-user-auth`), each in two stages: a verbatim copy + commit (diffable against
  upstream), then modification. Extend `fast-image-processing` with sprite-sheet
  and collage/montage primitives next to `cacheThumbAndGetBuffer()`. **Widen the
  JWT signing key** from 96-bit `randomBytes(3*4)` to ≥256-bit. Archive the two
  GitHub repos once the monorepo is source of truth.
- **Add a request-triggered per-album build pass** that decodes each image once
  and writes a FS-cached **collage cover**, **date-grouped sprite sheets**, and a
  **manifest** (groups, counts, cell→image map, dims, per-sheet content hashes).
  Single-flight lock; per-sheet content-hash invalidation; new photos **append**
  new sheets. Date buckets come from EXIF (piggybacked on the decode).
- **Add a build/progress API**: first request to a cold album returns
  `202 building`; a status endpoint drives a real progress bar and lets the client
  render sheets as they land. New endpoints serve the cover, sheets, and manifest.
- **Re-architect the album view** to a fixed square-cell sprite grid (Google/Apple
  Photos style), mobile-first, pinch-zoom changes column count (cells baked at max
  display size, CSS-scaled down). Keep aspect-correct display in the lightbox and
  keep the existing enrichment-metadata overlay. **Home album covers** become a
  cached collage of all images instead of a 50-image distributed thumbnail sample.
- **Finish migration nav gaps**: wire "skip to month" buttons (GAP 1), add
  deep-link-to-image via URL params (GAP 3), add a custom 404 page (GAP 4), and
  **remove the dead `/collection/[album]` link** (GAP 2) now that the sprite album
  view is the scalable path to full-size images.
- **Harden the deployment** — **BREAKING** for operators (compose/env changes):
  env-injected strong secrets with no insecure defaults (cookie secret, Meili
  master key); internal-only datastore networking; **remove the unused Mongo
  service**; TLS via reverse proxy + `Secure` cookies; healthchecks +
  `restart:` + `depends_on: service_healthy`; **multi-stage image** that builds the
  static frontend at image-build time (not container start); named/durable volumes
  including the new sprite cache; CPU/memory limits sized to the build pass.

## Capabilities

### New Capabilities
- `vendored-image-toolkit`: Both `jwater7` libraries folded in-tree as the source
  of truth; `fast-image-processing` extended with sprite-sheet/collage primitives;
  JWT signing key widened to ≥256-bit; upstream repos archived.
- `album-build-cache`: Request-triggered, single-flight per-album build pass that
  decodes each image once and produces FS-cached collage cover, date-grouped sprite
  sheets, and a manifest, with per-sheet content-hash invalidation and append-on-add.
- `album-build-progress`: Build status/progress protocol — `202 building`, a status
  endpoint for a real progress bar, and endpoints serving cover/sheets/manifest.
- `scalable-album-browsing`: Frontend sprite-cell square-grid album view and collage
  home covers; mobile-first with pinch-zoom column count; aspect-correct lightbox that
  preserves the enrichment-metadata overlay; album view no longer fetches full
  per-file metadata up front.
- `gallery-navigation`: Migration-completeness navigation — skip-to-month jump,
  deep-link to a specific image, custom 404, and removal of the dead `/collection` link.
- `production-deployment`: Hardened, reproducible deployment — strong injected secrets
  with no insecure defaults, internal-only datastores, Mongo removed, TLS + `Secure`
  cookies, healthchecks/restart/ordered startup, multi-stage image, durable named
  volumes for all state incl. the sprite cache, and CPU/memory limits sized to builds.

### Modified Capabilities
<!-- None. The existing promoted specs (authenticated-enrichment-routing,
dev-runtime-modes, enrichment-metadata-ui, ocr-delta-scan, ocr-progress-tracking,
ocr-status-api) keep their current requirements. The new album view must continue to
surface enrichment metadata, but that preserves enrichment-metadata-ui's behavior
rather than changing its requirements. Album browsing today is not a promoted spec. -->

## Impact

- **Backend**: `handlers/image-handler.js` (new build/manifest/sprite/collage paths
  alongside `cacheThumbAndGetBuffer`/`limitResults`), `routes/api.js` (new
  build-status + artifact endpoints under the existing `/api/v1/*` auth surface),
  `app.js` (cookie secret env-injected). New FS cache tree under `/data/cache/<album>/`.
- **Vendored libraries**: `fast-image-processing` and `jwt-user-auth` move in-tree;
  `package.json` deps change from `github:jwater7/*` to the in-tree packages;
  `jwt-user-auth` key width changes (no token-format break — same HS256 secret).
- **Frontend**: `pages/album.js`, `pages/home.js`, `data/use-list.js`,
  `data/use-thumbs.js`, `components/{AlbumElement,MetaLightbox,ImageList}.js`, plus a
  new sprite-grid component, a `404.js`, and deep-link URL handling.
- **Deployment**: `Dockerfile` (single-stage → multi-stage), `docker-compose.yml`
  (secrets, ports, healthchecks, restart, volumes, resource limits, Mongo removed),
  and the real prod compose (`debug-data/example-prod-docker-compose.yml`, which still
  sets a now-removable `DBHOST`). Operators must supply real secrets — **breaking** for
  existing deploys relying on defaults.
- **Out of scope / untouched**: the in-progress `image-enrichment-platform` change and
  the enrichment plane's behavior; browsing must keep working off the FS cache when the
  enrichment DB is down (existing degraded-mode design).
