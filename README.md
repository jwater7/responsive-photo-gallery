# responsive-photo-gallery
NodeJS backend to serve a photo collection in a mobile-friendly and beautiful way
The Express web server will start up on port 3000 by default (this can be changed with the PORT environment variable).

To run using a docker container (uses local port 8000 to expose default port 3000 so you can bring up a web browser to http://localhost:8000/):
~~~~
docker run -d --name responsive-photo-gallery -v '/path/to/album/folders:/images:ro' -v '/your/persistent/storage/dir:/data:rw' -p 8000:3000 jwater7/responsive-photo-gallery
~~~~

There is also a companion enrichment image
(`jwater7/responsive-photo-enrichment-indexer`) for OCR / smart search / map; the
easiest way to run both together is docker compose — see
[Bringing up the full stack](#bringing-up-the-full-stack-with-docker-compose)
below.

To run from source: this repo is an **npm-workspaces monorepo** (the gallery
under `gallery/`, the enrichment service under `enrichment/`, shared packages
under `packages/`). A single root `npm install` installs every workspace. For
local development with hot reload see
[Local development](#local-development-native-with-hot-reload) below; for running
the whole stack use docker compose.

The backend may be customized using environment variables:
* SWAGGER_ROOT_PATH (default '')
  Set swagger documentation (available at /api-docs/) api root path
* PORT (default 3000)
  Set express server port
* DEFAULT_PASSWORD (default is a random base64 string)
  Sets the default API admin password (written to config file)
* DEFAULT_PRIVATE_KEY (default is a random base64 string)
  Sets the JSON Web Token signing key (to be consistent over reboots)
* PRIVATE_KEY (default is a random base64 string)
  Overrides the JSON Web Token signing key with a new one
* CONFIG_PATH (default '/data/config')
  Root for runtime config that persists across restarts: the auth store
  (`CONFIG_PATH/auth`) and the album exclude list (`CONFIG_PATH/excludes.json`)
* AUTH_PATH (default '`CONFIG_PATH`/auth')
  Overrides the auth data directory. If unset, auth lives under `CONFIG_PATH`. A
  legacy `/data/auth` config is auto-migrated once on first boot, so the admin
  login + JWT signing key survive the move (no fresh password)
* TAGS_PATH (default '/data/tags')
  Sets the path to the tags data directory for persistance of tag links and saved favorites
* IMAGE_PATH (default '/images')
  Sets the path the the photos
* CACHE_PATH (default '/data/cache')
  Sets the path to the derived-image cache. Per album it holds the build
  artifacts (manifest.json, cover.jpg, sprites/) plus the thumbnail caches
  (thumbs/, and video-thumbs/ for video poster frames)
* DEBUG
  You may also use the debug package variables for some debugging output (for example, DEBUG=express,responsive-photo-gallery:\*)
* NO_AUTHENTICATION (default false)
  If set to "yes" then all users will have full access to all read-only backend calls and will not be prompted for a password

The frontend is a Next.js app whose base-path knobs are **frozen at build time**
(Next inlines `NEXT_PUBLIC_*`/`PUBLIC_URL`). The published image bakes sentinels
that the container entrypoint rewrites at startup, so one image works at any path
— set these on the container, not at build:
* PUBLIC_URL (default '/')
  The single base-path knob → Next `basePath` (asset/router URLs). Use e.g.
  `/photos` to serve under a sub-path (the reverse proxy must strip the prefix)
* NEXT_PUBLIC_BASENAME (default `PUBLIC_URL`)
  Optional override for the router basename + login cookie path
* NEXT_PUBLIC_API_PREFIX (default `PUBLIC_URL`)
  Optional override for the API endpoint (may be a different path or origin)

See [Production deployment](#production-deployment) for how these are applied.

## Image enrichment, search & map

An optional, isolated enrichment plane adds OCR, semantic ("smart") search, and
a geo map on top of the gallery. It runs as separate containers (enrichment
service + Redis + MeiliSearch) and is reached only through the gallery's
**authenticated** `/api/v1/enrich/*` proxy — the enrichment service itself is not
exposed to the host in the default configuration, so the gallery is the single
controlled entry point. The gallery keeps working with the whole plane stopped.
See [docs/architecture.md](docs/architecture.md) for diagrams of the container
topology, the enrichment pipeline, the search/map read paths, and the
air-gapped build.

### Bringing up the full stack with docker compose

The bundled `docker-compose.yml` runs the gallery plus the whole enrichment
plane (enrichment service + Redis + MeiliSearch). Photos are read from
`./debug-data/pics`; drop your own album folders there (or edit the volume).

1. Build and start everything (the first build bakes the CLIP model, so it
   takes a few minutes):
   ~~~~
   docker compose up --build
   ~~~~
   Ports: gallery on http://localhost:3000, MeiliSearch on
   http://localhost:7700. The enrichment service is **not** published to the host
   in this default config (it is reachable only on the internal network, via the
   gallery's authenticated `/api/v1/enrich/*` proxy). For direct access to its API
   + Swagger UI on http://localhost:8080, bring it up with the dev override
   instead: `npm run dev:deps` (or
   `docker compose -f docker-compose.yml -f docker-compose.deps.yml up -d`).

2. Log in to the gallery at http://localhost:3000. The app writes a random admin
   password to its auth config on first boot (see `DEFAULT_PASSWORD` /
   `NO_AUTHENTICATION` above to set your own, e.g. add
   `DEFAULT_PASSWORD=changeme` to the `rpg-app-local` environment).

3. Trigger the initial enrichment scan. New/changed files are picked up
   automatically, and a reconcile runs periodically, but existing photos need
   one kick to be indexed the first time. This is non-blocking (returns
   immediately). The easiest way is the **Admin** tab in the gallery — a
   "Full scan" button with live status. Or, since the enrichment port is
   internal, run it inside the container:
   ~~~~
   docker compose exec rpg-enrichment-indexer curl -sX POST http://localhost:8080/api/v1/enrichment-sync
   ~~~~

4. Watch progress. The first request loads the model; CPU embedding is slow
   (seconds per image), so give it time on a large library:
   ~~~~
   docker compose exec rpg-enrichment-indexer curl -s http://localhost:8080/api/v1/status
   # the same data the UI sees is available through the gallery's authenticated
   # proxy at /api/v1/enrich/status (log in first so the request carries the cookie)
   ~~~~

5. Once photos are indexed, use the **Search** and **Map** tabs in the gallery
   (they appear automatically when the enrichment service is reachable). Search
   has a **Smart** toggle for semantic search; the map plots geotagged photos
   and filters by the visible area.

To stop and remove the containers: `docker compose down`. All host-side state —
gallery (auth, tags, the sprite + thumbnail cache) and enrichment (Redis,
MeiliSearch) — is bind-mounted under `./debug-data` and persists across
restarts. To start fresh, delete the relevant subdirectories: `auth` (login +
keys) and `tags` (favorites) are durable user state; `cache`, `meili`, and
`redis` are regenerable (rebuilt / re-indexed on next run).

### Generating test images (programmatically)

`./debug-data/pics/<album>/` is just a folder of images, so you can synthesize
test albums instead of copying real photos. Two things matter:

- **Unique content per file** — documents are keyed by *content hash*, so
  byte-identical files collapse into one. Vary each image (a colour + label).
- **GPS for the map** — the geo enricher reads EXIF GPS (`exifr.gps`) and derives
  the H3 density cells from it. Tag images with coordinates to place them on the
  map; cluster many at (nearly) one spot to exercise the cell grouping.

`sharp` (a workspace dependency) rasterises an SVG to JPEG; `piexifjs` (a tiny
pure-JS EXIF writer) injects the GPS. Save the script **inside `enrichment/`** (so
`require('sharp')` resolves — Node looks up `node_modules` from the script's own
directory) and run it there, after `npm i --no-save piexifjs`:

~~~~
// gen-test-images.js — node gen-test-images.js <album> <count> <lat> <lng> <jitterDeg>
//   node gen-test-images.js test-grouping 30  48.8584   2.2945   0.00005   (Eiffel: circle, then thumbnails near zoom)
//   node gen-test-images.js dense-spot    100 -33.8568  151.2153 0.00002   (>60 in one cell: dense circle at every zoom)
const fs = require('fs'), path = require('path');
const sharp = require('sharp');
const piexif = require('piexifjs');
const [album='test', count='20', lat0='47.62', lng0='-122.35', jit='0.00005'] = process.argv.slice(2);
const OUT = path.resolve('..', 'debug-data', 'pics', album);

const toDMS = d => { const a=Math.abs(d),D=Math.floor(a),mf=(a-D)*60,M=Math.floor(mf),S=Math.round((mf-M)*60*1e4); return [[D,1],[M,1],[S,1e4]]; };
const gps = (lat,lng) => piexif.dump({ GPS: {
  [piexif.GPSIFD.GPSLatitudeRef]: lat>=0?'N':'S', [piexif.GPSIFD.GPSLatitude]: toDMS(lat),
  [piexif.GPSIFD.GPSLongitudeRef]: lng>=0?'E':'W', [piexif.GPSIFD.GPSLongitude]: toDMS(lng) } });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (let i = 1; i <= +count; i++) {
    const hue = Math.round(360 * i / +count);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="100%" height="100%" fill="hsl(${hue},70%,50%)"/><text x="50%" y="50%" font-size="56" fill="#fff" text-anchor="middle" dominant-baseline="middle">${album} ${i}</text></svg>`;
    const jpeg = await sharp(Buffer.from(svg)).jpeg().toBuffer();
    const lat = +lat0 + (Math.random()-0.5)*2*+jit, lng = +lng0 + (Math.random()-0.5)*2*+jit;
    const out = piexif.insert(gps(lat, lng), jpeg.toString('binary'));   // omit this line for plain (no-geo) images
    fs.writeFileSync(path.join(OUT, `img_${String(i).padStart(3,'0')}.jpg`), Buffer.from(out, 'binary'));
  }
  console.log(`wrote ${count} images to ${OUT}`);
})();
~~~~

Then index them: Admin → **Full scan**, or the `enrichment-sync` curl above (a
delta scan suffices — they're new files). The `jitterDeg` controls how tightly
images colocate: a few metres drops them all in one H3 cell (one count bubble
that opens a paged list); past `CELL_THUMB_LIMIT` (60) in a cell it stays a dense
circle even at max zoom, below it near zoom shows individual thumbnails.

### Map UI smoke test (Playwright)

`tools/map-check.js` drives the running gallery's map through deep-link URLs and
asserts on the rendered Leaflet DOM — off-screen bubbles, marker counts, blank
map, console errors — the things unit tests and backend queries can't see. It logs
in with the debug-data admin creds (never printed) and writes screenshots to
`tools/shots/` (gitignored).

~~~~
docker compose up -d                 # stack must be running, with some geotagged albums
npx playwright install chromium      # one-time browser download
npm run map-check                    # prints a per-scenario table; exits non-zero on failure
~~~~

Edit the `scenarios` list in `tools/map-check.js` to add viewports (each is a
`/map?lat=..&lng=..&z=..` deep-link). Pair it with the generated test albums above
(a dense pile, a small group) to check the zoom ladder end to end.

### Local development (native, with hot reload)

For fast iteration, run **Express and Next natively** (hot reload) while the
heavy/stateful backends (Redis, MeiliSearch, Mongo, and the CLIP enrichment
service) stay in Docker. The browser talks only to the Next dev server, which
forwards a single `/api/*` wildcard to the native Express API — so it is
same-origin, authentication works, and Next never talks to a backend directly.

~~~~
npm install        # one root install covers every workspace
npm run dev        # backends in docker + native Express + native Next
~~~~

`npm run dev` runs three things (also available individually):

* `npm run dev:deps` — backends in Docker, with the enrichment service's `:8080`
  re-published to localhost (via `docker-compose.deps.yml`).
* `npm run dev:api` — Express on **:8000** with `node --watch` (auto-reload),
  reading fixtures from `./debug-data`, proxying enrichment to
  `ENRICH_URL=http://localhost:8080`.
* `npm run dev:ui` — Next dev server on **:3000**, forwarding `/api/*` to `:8000`.

Open http://localhost:3000 and log in. Auth is **on** in dev (same-origin makes
the JWT cookie work); set `NO_AUTHENTICATION=yes` on `dev:api` only if you want to
skip login. Request flow:

~~~~
Browser → Next dev :3000  ──/api/* rewrite──▶  Express :8000  ──/api/v1/enrich──▶  enrichment :8080 (docker)
~~~~

### Production deployment

The bundled `docker-compose.yml` is the hardened production stack: no
host-published datastore ports, the frontend prebuilt into the image (no build
at container start), healthchecks + `restart: unless-stopped` + health-gated
startup, and CPU/memory limits on the app so a cold-album build can't OOM the
host. To deploy:

1. **Secrets are self-contained — nothing to supply.** Bringing the stack up
   needs no command-line env and no `.env` file. The cookie-signing secret and
   the JWT signing key are generated with strong entropy on first run and
   persisted in the `auth` mount (override the key with `PRIVATE_KEY` only if you
   want to pin it). MeiliSearch runs keyless on the internal network (no host
   port), so there is no master key to manage.

2. **Terminate TLS at a reverse proxy** (Caddy/Traefik/nginx) in front of the
   gallery and set `TRUST_PROXY=true` on the app so `req.secure` reflects
   `X-Forwarded-Proto` and the auth cookie is marked `Secure`. Serve over HTTPS
   only — the cookie is `HttpOnly` + signed and must not cross plaintext.

3. **Base path.** `PUBLIC_URL` is the single base-path knob: `/` for the domain
   root, or e.g. `/photos` to serve under a sub-path. The frontend is prebuilt
   with sentinels that the image entrypoint rewrites to `PUBLIC_URL` at container
   start, so one image works at any path. For sub-path hosting, the reverse proxy
   must **strip the prefix** before forwarding (Express serves at the container
   root). Two optional overrides, normally left unset (they default to
   `PUBLIC_URL`): `NEXT_PUBLIC_BASENAME` (router basename + login cookie path) and
   `NEXT_PUBLIC_API_PREFIX` (API endpoint, may be a different path/origin). These
   are `NEXT_PUBLIC_*` values frozen at build, so the entrypoint applies them at
   start — they are not read by the browser bundle directly.

4. **State lives on host bind mounts** (see the compose `volumes:`), all
   consolidated under `./debug-data`: gallery state (`auth`, `tags`, and the
   `/data/cache` tree holding both the sprite/collage cache and the thumbnail
   cache) plus the enrichment `meili`/`redis` data. Point the `:/images:ro` mount
   at your real album folders. **Back up** these directories — `auth` in
   particular holds the JWT signing key and the cookie secret. Bind mounts (not
   named volumes) are used so the data survives `docker volume prune`.

5. **Resource limits.** The app service is bounded (`cpus: "2.0"`, `memory: 2g`)
   so a large cold-album build (sharp + ffmpeg, running alongside the enrichment
   container's CLIP work) cannot exhaust the host. Tune to your hardware.

6. **Logging** stays on the `debug` package: `DEBUG=responsive-photo-gallery:*`
   is set on the app in the compose (raise/lower verbosity by editing it).

A minimal published-image example (reverse-proxied under `/photos`) is in
[`debug-data/example-prod-docker-compose.yml`](debug-data/example-prod-docker-compose.yml).

