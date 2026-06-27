# Why

The enrichment platform now works, but its plumbing has two gaps and a papercut
that bite as soon as more than one person (or one machine) touches it:

1. **The enrichment plane is unauthenticated.** `/api/enrich/*` is mounted as a
   sibling to `/api/v1/*`, *outside* the passport JWT middleware, so anyone who
   can reach the gallery can hit search/geo/status without logging in. Worse, the
   enrichment service itself is **published directly on host `:8080`** ("for
   local testing"), a second open door that the proxy auth would not close.
   We want a single authenticated front door and everything behind our existing
   login mechanism.

2. **Two run modes disagree on where data lives.** `docker compose` mounts
   `./debug-data/auth`, `./debug-data/thumbs`, `./debug-data/tags`, while the
   native `npm run debug` script writes to `./debug-data/data/auth`,
   `./debug-data/data/thumbs`, `./debug-data/data/tags`. The same logical state
   lands in two different directories depending on how you ran the app, so native
   and docker dev silently diverge.

3. **No first-class "edit fast" loop.** Iterating on the gallery UI/API means a
   full container rebuild. We want to run the two things we edit constantly —
   Express and Next — natively with hot reload, while the heavy/stateful
   backends (Redis, MeiliSearch, Mongo, the CLIP enrichment service) stay
   dockerized.

These are entangled: a unified dev loop (3) is only painless once both run modes
agree on one set of paths (2), and the auth model (1) must have a clean, explicit
bypass for native dev so iterating doesn't mean fighting cookies.

This change does **not** add features. It hardens routing/auth and unifies the
developer runtime around the platform that already exists.

---

# What Changes

## Authenticated enrichment routing

- **Mount the enrichment proxy inside the authenticated API tree.** Move it from
  `/api/enrich` to `/api/v1/enrich`, behind the same passport JWT gate as the
  rest of the gallery API. The same `NO_AUTHENTICATION=yes` escape hatch applies
  for free.
- **Share the gate, don't duplicate it.** Extract the one ~6-line auth gate into
  `lib/require-auth.js`; both `routes/api.js` and the enrich mount use it.
  `routes/enrich.js` stays a single, self-contained *plain* router (no factory),
  removable by deleting the file plus one mount line in `app.js`.
- **Update the client suffix.** `frontend/lib/enrich-api.js` targets
  `api/v1/enrich` instead of `api/enrich`. No other client change.
- **Close the second door.** The prod/default compose does **not** publish the
  enrichment service's `:8080`; it is reachable only on the internal docker
  network. Direct host exposure moves to a dev/debug override. The enrichment
  service trusts its private network; the gallery is the only authenticated
  entry point.

## Unify the data paths (minimal fix)

- **Eliminate the `debug-data/data/` nested duplicate.** Make the native
  `npm run debug` script and `docker-compose.yml` reference **one** set of paths
  for auth/thumbs/tags (and mongo). Scope is the inconsistency only — no broad
  restructure of `data/` vs `debug-data/`.

## Express as the single backend (Next funnels through one wildcard)

- **One backend channel.** Next reaches the backend only through a single
  wildcard `/api/*` to the Express API (the dev `rewrites` proxy is **kept** — it
  *is* that channel). Folding enrichment into `/api/v1/enrich` puts it on the same
  channel and behind the same auth, instead of being a separate plane. Next never
  talks to the enrichment service directly.

## Native + docker dev modes

- **A deps-only compose override** (`docker-compose.deps.yml`) that re-publishes
  the enrichment service's `:8080` to localhost; `dev:deps` brings up only Redis,
  MeiliSearch, Mongo, and the enrichment service — not the gallery app container.
- **Native dev scripts** (in `package.json`, no Taskfile): `dev:api` runs Express
  natively on `:8000` with `node --watch` (auto-reload) and
  `ENRICH_URL=http://localhost:8080`; `dev:ui` runs the Next dev server on `:3000`
  with its single `/api/*` rewrite pointing back at `:8000`; `dev` runs both plus
  the backends.
- **Same-origin in both modes.** The browser stays same-origin to Next (dev) or
  Express (prod), so the JWT cookie just works and **auth stays ON** — no CORS and
  no auth bypass needed. `NO_AUTHENTICATION=yes` remains available as an opt-in
  escape hatch.

## Surface enrichment in the UI + inline favoriting (added during implementation)

Once enrichment rode one authenticated channel, exposing it in the UI was the
natural next step:

- **Shared metadata panel** (`ImageMeta`) in a shared lightbox wrapper
  (`MetaLightbox`) used by album, search, and map: AI tags, OCR text, place/coords,
  taken-date, type/size — as a fading footer (auto-hides; pinned via an info
  button) with a download button. Mobile-friendly (height-capped, scrollable,
  safe-area aware).
- **Album shows it too**, fetching its images' enrichment **fail-soft and gated
  behind the `features` flag** — so the gallery still works when the enrichment
  plane is down (preserves gallery independence).
- **Inline favorite ★** in the lightbox toolbar via `PATCH /api/v1/image-data
  { tags }`, optimistic with a live Favorites section (SWR cache mutate).
- **Two backend fixes surfaced by the above:** the tag-write path's `mkdirp@3`
  import, and an honest `description` field (optional sidecar `<file>.txt`, no
  filename fallback).

---

# Capabilities

### New

- **authenticated-enrichment-routing** — the enrichment plane is reachable only
  through the gallery's authenticated API, with no unauthenticated host-exposed
  port in the default/prod configuration, while staying a removable feature.
- **dev-runtime-modes** — Express is the single backend, reached by Next through
  one wildcard `/api/*`, and there are two documented, path-consistent ways to run
  the stack: fast native hot-reload (Express + Next native, backends dockerized)
  and a prod-like full docker-compose mode.
- **enrichment-metadata-ui** — a shared, fail-soft lightbox metadata panel
  (tags/OCR/place/date) across album, search, and map, plus inline favoriting; the
  gallery keeps working when enrichment is unavailable.

### Unaffected

- Enrichment computation itself (OCR, embeddings, geo, map, search) — this change
  routes/authorizes it and surfaces it in the UI; it does not alter the models or
  the pipeline.

---

# Impact

## Affected code

- `lib/require-auth.js` (new) — single source of truth for the JWT gate.
- `app.js` — enrich mounts at `/api/v1/enrich` behind `requireAuth(passport)`.
- `routes/api.js` — uses `requireAuth(passport)` instead of its inline `required`.
- `routes/enrich.js` — stays a plain router; only the mount changes.
- `frontend/lib/enrich-api.js` — suffix `api/enrich` → `api/v1/enrich`.
- `frontend/next.config.js` — unchanged; the `/api/*` rewrite is the single
  dev channel and is kept.
- `package.json` + `frontend/package.json` scripts — native `dev:*` loop
  (`node --watch`, single `/api/*` rewrite) and the unified `debug` data paths.
- `handlers/image-handler.js` — honest `description` via sidecar `<file>.txt`;
  fix `mkdirp@3` import so tag (favorite) writes work.
- `routes/api.js` — `PATCH /image-data` already accepts `{ tags }` (used by the
  inline favorite).
- `frontend/components/ImageMeta.js`, `frontend/components/MetaLightbox.js` (new) —
  shared metadata panel + lightbox wrapper (info/timed-fade/download/favorite).
- `frontend/pages/album.js`, `frontend/pages/search.js`,
  `frontend/components/map/MapView.js` — refactored onto `MetaLightbox`; controlled
  lightbox index; album fail-soft enrichment fetch + inline favorite.
- `frontend/components/navbar.js` — `Home` tab; `frontend/data/use-list.js` —
  exposes `mutate` for the live Favorites update.

## Affected infrastructure

- `docker-compose.yml` — drop the published `:8080` on the enrichment service in
  the default config; align the gallery and native data-path mounts.
- New `docker-compose.deps.yml` — override that re-publishes the enrichment
  service's `:8080` to localhost for native dev (`dev:deps`).

## Non-goals

- No new enrichment features or model changes.
- No broad `data/` vs `debug-data/` restructure — only the duplicate-path bug.
- No change to the gallery's auth mechanism itself (same passport JWT cookie); we
  only extend its coverage to enrichment routes.
- No production secrets/key-management overhaul; `NO_AUTHENTICATION` stays the
  opt-in escape hatch it already is (dev runs auth ON by default).
