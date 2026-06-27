# Design

## Context

Current routing (app.js):

```
Express :3000
  /api/v1/*      → routes/api.js   [passport JWT cookie auth]
  /api/enrich/*  → routes/enrich.js [NO AUTH] ── proxy ──▶ rpg-ocr-indexer
  /* (static)    → frontend/build
```

`rpg-ocr-indexer` is also published on host `:8080` (no auth). The enrichment
plane is therefore reachable two ways, neither authenticated. The gallery is a
static Next export served same-origin by Express, so the browser already carries
the JWT cookie to any `/api/...` path.

There are **no Next API routes** (`pages/api/` does not exist). Next reaches the
backend only through a single wildcard `/api/*` — in dev via the `rewrites` proxy
in `next.config.js`, in prod by being served same-origin by Express. The problem
is not that channel; it is that enrichment was a *separate* plane alongside it
(`/api/enrich`, unauthenticated, plus a directly published `:8080`).

## Goals / Non-goals

- Goals: the Express API is the single backend everything goes through, reached
  by Next via one wildcard `/api/*`; enrichment rides that same authenticated
  channel instead of being a separate plane; enrichment stays a delete-one-file
  feature; one set of data paths across run modes; a fast native hot-reload loop
  alongside a prod-like docker mode.
- Non-goals: new features, auth-mechanism changes, broad data restructure,
  removing the `/api/*` rewrite (it is the single channel, and it is kept).

## Decision 1 — Authed via a shared gate helper (no factory, no merge)

The only route-gating logic in `routes/api.js` is a single ~6-line middleware
(`required`); everything else auth-related there (`getCommonCookieOptions`,
`auth.login`, `res.cookie`) is about *issuing* tokens at login, which the proxy
does not do. So "enrich behind auth" means reusing that one gate, not duplicating
auth.

Options considered:

- **A. Factory** — `enrich.js` becomes `({ passport, auth }) => router` and copies
  the gate. Removable, but copies the 6 lines and adds ceremony.
- **B. Shared gate helper** (chosen) — extract the gate once; both routers use it.
  No duplication, no factory, `enrich.js` stays a plain router.
- **C. Merge the proxy into `routes/api.js`** — no duplication (gate already
  there) but destroys the "delete one file" removability and mixes the gallery
  API with the proxy concern.

B avoids the duplication that motivated C while keeping the removability that
motivated A — strictly better than both.

```js
// lib/require-auth.js — single source of truth for the gate
module.exports = (passport) =>
  process.env.NO_AUTHENTICATION === 'yes'
    ? (req, res, next) => next()
    : passport.authenticate('jwt-cookiecombo', { session: false, failWithError: true })
```

```js
// app.js — enrich.js stays a plain router (unchanged); gate applied at the mount
const requireAuth = require('./lib/require-auth')
app.use('/api/v1/enrich', requireAuth(passport), require('./routes/enrich'))
```

`routes/api.js` replaces its inline `required` with `requireAuth(passport)`.
(Standardize the no-auth branch on a `(req,res,next)=>next()` passthrough rather
than the current `[]`, so the helper behaves identically as mount-level and
in-router middleware.)

Client: `frontend/lib/enrich-api.js` changes its suffix from `api/enrich` to
`api/v1/enrich`; its prefix-derivation logic is unchanged.

Removability is preserved: delete `routes/enrich.js` and its one mount line in
`app.js`. (`lib/require-auth.js` is shared with the gallery API and stays.)

Consequence: `/features` now requires auth. Acceptable — feature flags are only
consumed by the logged-in UI; nothing pre-login needs them. Re-expose explicitly
later only if a pre-login probe is ever needed.

## Decision 2 — Close the direct port, trust the private network

Auth on the proxy does nothing about the host-published `:8080`. So the default
compose stops publishing it; the enrichment service is reachable only on the
internal docker network from the gallery container.

Threat model: the enrichment service stays unauthenticated *internally* (it
trusts callers on its private network). The only externally reachable surface is
the gallery's authenticated `/api/v1/enrich/*`. Direct `:8080` (and Meili `:7700`,
Redis `:6379`) publishing moves to the deps/dev override, used only when running
the app natively against dockerized backends.

```
default / prod compose            native-dev (deps override)
──────────────────────            ──────────────────────────
app:3000  (auth) ──┐              Express(native, :8000, auth ON) ──┐
                   │ internal net                                   │ ENRICH_URL
ocr (no host port) ◀              ocr (:8080 re-published) ◀────────┘
meili/redis (internal)            redis/meili reached internally by ocr
```

## Decision 3 — Minimal data-path fix

Scope is the divergence bug only, not a restructure. Today:

- compose mounts `./debug-data/{auth,thumbs,tags}` and `./debug-data/mongo-data-db`
- `npm run debug` uses `./debug-data/data/{auth,thumbs,tags}`

Pick the path set compose already uses (`./debug-data/{auth,thumbs,tags}`),
point the native `debug` script at the same, and remove the now-orphaned
`debug-data/data/` nested copy. After this, native and docker dev read/write the
same directories. `data/` (meili/redis/models infra state) is left untouched.

## Decision 4 — Express is the single backend; Next reaches it via one wildcard

Intent (clarified): Next should funnel *all* backend communication through a
**single wildcard `/api/*`** to the Express API, and the Express API is the one
backend everything goes through. This is **not** "remove `rewrites`" — the
wildcard rewrite *is* that single channel in dev. The change is to make sure
enrichment rides that one channel instead of being a separate plane: moving it to
`/api/v1/enrich` folds it under the same `/api/*` surface and the same auth gate.

```
Browser ──▶ Next ( single /api/* wildcard ) ──▶ Express API   ← the ONE backend
                                                  ├─ /api/v1/*        gallery (authed)
                                                  └─ /api/v1/enrich/* enrich  (authed) ──▶ enrichment svc
prod: Express serves the static export same-origin and exposes the same API.
```

Next never talks to the enrichment service (or any backend) directly — only to
the Express API via `/api/*`. There are no Next API routes. `rewrites` is kept.

## Decision 5 — Two run modes that both preserve the single channel

Principle: only Express and Next ever run natively; Redis/Meili/Mongo/CLIP always
run in docker (CLIP needs glibc + baked weights — painful natively, per project
notes).

Native dev keeps the existing single-wildcard rewrite, so the browser stays
same-origin to the Next dev server and the gallery's JWT cookie keeps working —
no CORS, no auth bypass needed:

```
NATIVE DEV                                  DOCKER-COMPOSE (prod-like)
──────────                                  ──────────────────────────
Browser ─▶ Next dev :3000                   Browser ─same-origin─▶ Express :3000
   │ /api/* rewrite (NEXT_PUBLIC_API_PREFIX     (serves static build, auth ON)
   │   =http://localhost:8000)                          │
   ▼                                                    ▼
Express (native) :8000  auth ON, node --watch    Express → backends (internal net)
   └─ /api/v1/enrich → ENRICH_URL=http://localhost:8080 (dockerized ocr)
backends (redis/meili/mongo/ocr) in docker; ocr :8080 published by the override
```

- `docker-compose.deps.yml`: a thin override of the main compose that re-publishes
  the enrichment service's `:8080` to localhost (the default compose keeps it
  internal). `dev:deps` brings up only the four backend services.
- `package.json` scripts (no Taskfile): `dev:deps` (backends), `dev:api`
  (`node --watch ./bin/www` on :8000, debug-data paths, `ENRICH_URL=http://localhost:8080`,
  auth ON), `dev:ui` (`cd frontend && npm run dev` → Next on :3000 with the
  `/api/*` rewrite to :8000), `dev` (all three). `start`/`build-frontend` remain
  the prod-like path.
- Auth stays ON in both modes (same-origin via the rewrite makes cookies work in
  dev); `NO_AUTHENTICATION=yes` remains available as an opt-in escape hatch but is
  not the default. Reload is `node --watch` (built-in, no new dependency).

## Risks / trade-offs

- **`/features` behind auth** could surprise a future pre-login consumer — noted
  above; reversible. In dev you log in once (cookie persists); before login the
  search/map surfaces fail soft to "unavailable", which also exercises the real
  degraded path.
- **Port coupling**: the Next `/api/*` rewrite destination (`:8000`) must match
  `dev:api`'s `PORT`. Both are pinned to `8000`; changing one means changing the
  other.
- **Removability regression risk**: the shared `lib/require-auth.js` must not pull
  enrichment into gallery hot paths; `npm run test:isolation` should keep passing
  and cover the new mount.

## Migration / rollout

1. Shared gate + enrich under `/api/v1/enrich` + client suffix + un-publish
   `:8080` (Decisions 1–2).
2. Data-path unification (Decision 3) — verify native and docker share state.
3. Deps override + native `dev:*` scripts, preserving the single `/api/*` rewrite
   (Decisions 4–5).

Each step is independently revertable; Decision 1 keeps the whole enrichment
feature deletable as before.
