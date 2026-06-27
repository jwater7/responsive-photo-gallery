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

