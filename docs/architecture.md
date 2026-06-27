# Image enrichment, search & map — architecture

This document describes the optional **image-enrichment plane** (OCR, semantic
search, geo/map) that runs alongside the photo gallery. It is additive and
isolated: with the entire enrichment plane stopped, the gallery still browses,
authenticates, views, and uploads. The search box and map simply hide
themselves (a runtime `features` flag flips off).

## Container topology

```
                       ┌─────────────────────────── docker compose ───────────────────────────┐
 browser               │                                                                       │
   │                   │   rpg-app-local (Express + static Next export)                        │
   │  :3000            │   ┌─────────────────────────────────────────────┐                    │
   └──────────────────────►│  /                → serves frontend/build/   │                    │
                       │   │  /api/v1/*         → gallery API (photos)     │                    │
                       │   │  /api/v1/enrich/*  → PROXY to enrichment ─────┼───┐                │
                       │   └─────────────────────────────────────────────┘   │                │
                       │   auth/tags: node-json-db file store (no DB service) │                │
                       │                                                      │ :8080          │
                       │   rpg-enrichment-indexer (API only) ◄────────────────┘                │
                       │   ┌─────────────────────────────────────────────┐                    │
                       │   │  Express API: search / status / triggers     │                    │
                       │   └───────────────────┬─────────────────────────┘                    │
                       │   rpg-enrichment-worker (separate process)        │ control jobs      │
                       │   ┌─────────────────────────────────────────────┐ │                  │
                       │   │  BullMQ worker + watcher + reconcile cron    │ │                  │
                       │   │  enrichers: OCR · CLIP · geo · caption       │ │                  │
                       │   └───┬───────────────┬───────────────┬─────────┘ │                  │
                       │       │ jobs          │ index/search  │ reads files│                  │
                       │   ┌───▼────┐      ┌────▼─────────┐   ┌─▼──────────┐│                  │
                       │   │ redis  │◄─────│ meilisearch  │   │ /images RO ││                  │
                       │   │(BullMQ)│      │ (docs index) │   │ (photos)   ││                  │
                       │   └────────┘      └──────────────┘   └────────────┘                   │
                       └───────────────────────────────────────────────────────────────────────┘
```

The gallery only ever reaches enrichment through the `/api/v1/enrich/*` proxy
(`routes/enrich.js`). There is no gallery hot-path import of the enrichment
plane (enforced by `npm run test:isolation`), so the two can fail independently.
The enrichment plane itself is **two processes sharing one image**: the
`rpg-enrichment-indexer` API (`bin/server.js` — search/status/triggers, plus the
short search-query text embed) and the `rpg-enrichment-worker`
(`bin/worker.js` — BullMQ worker, watcher, reconcile cron). Triggers ride a
Redis `enrichment-control` queue from the API to the worker, so heavy CLIP/OCR
inference never blocks the API's `/health` or search.

## Enrichment pipeline (how a photo becomes searchable)

```
  new/changed image
        │
        ▼
  ┌───────────────┐   one job per file,
  │ enqueue       │   keyed by content hash      ┌──────────────┐
  │ (watcher /    │ ───────────────────────────► │ Redis/BullMQ │
  │  reconcile /  │                              │   queue      │
  │  POST upload) │                              └──────┬───────┘
  └───────────────┘                                     │ worker pulls
                                                         ▼
        ┌───────────────── ordered, idempotent enricher stages ─────────────────┐
        │   OCR ──────────►  content       (native tesseract)                    │
        │   CLIP ─────────►  _vectors.image + tags[]   (local ONNX, no cloud)    │
        │   geo ──────────►  _geo + place + taken_at   (EXIF + offline GeoNames) │
        │   caption ──────►  caption       (IPTC/XMP/IFD0 embedded description)  │
        └───────────────────────────────┬────────────────────────────────────────┘
                                         │ partial upsert merged by hash
                                         ▼
                                 ┌──────────────┐
                                 │ MeiliSearch  │  one "docs" record per photo:
                                 │  docs index  │  { hash, path, text, tags[],
                                 └──────────────┘    _vectors, _geo, place, taken_at }
```

Each stage writes only its own fields and is keyed by the photo's content hash,
so a re-scan **adds only what is missing** rather than reprocessing everything.
All inference is local; no stage makes an outbound call.

Triggers are non-blocking — `POST /api/v1/enrichment-sync` (and upload-time enqueue)
return immediately (`started`/`running`); progress is observed via `/status`.

## The three read paths

All three are queries against the single `docs` index, via the proxy.

```
  GALLERY (home/album)        SEARCH tab (/search)            MAP (/map)
  ───────────────────         ──────────────────             ──────────
  browse albums &             query box + Smart toggle       Leaflet viewport
  view photos                 │                              │ pan/zoom = the query
  (gallery API only,          ▼                              ▼
   no enrichment)        POST /api/enrich/search        POST /api/enrich/search
                              │                              │  geoBoundingBox
              ┌───────────────┴───────────────┐              │  (clamped to ±180/±90)
              │ Keyword          Smart         │              │  semanticRatio 0 (keyword)
              │ semanticRatio 0  ratio 0.6 +   │              ▼
              │ (text/tags/place)threshold 0.62│        clustered photo pins
              │                  (CLIP, filters│        (supercluster)
              │                   by meaning)  │        click → lightbox
              └───────────────┬───────────────┘
                              ▼
                     album-grid results + lightbox
```

- **Keyword** (`semanticRatio: 0`) — the words appear in text/tags/place.
  Precise; behaves like a filtered gallery.
- **Smart** (`semanticRatio: 0.6`, `rankingScoreThreshold: 0.62`) — embeds the
  query with the same CLIP model and compares to image vectors, dropping
  matches below the relevance threshold so it *filters* by meaning rather than
  re-ranking the whole collection. The threshold is tuned for the default CLIP
  model; raise it to be stricter.
- **Map** — the viewport bounding box is the filter; a text query narrows the
  pins within it. The box is clamped to valid lat/lng because MeiliSearch
  rejects an out-of-range `_geoBoundingBox`.

## Build & air-gap

```
  docker compose up --build
        │
        ├─ rpg-app-local image
        │     COPY source ─► (at container start) next build ─► frontend/build/
        │     • next.config: PUBLIC_URL "/" normalized to no basePath
        │     • build-frontend: `cd frontend && npm run build` (failures propagate)
        │
        └─ rpg-enrichment-indexer image (Debian slim — onnxruntime/sharp need glibc)
              • apt: tesseract
              • curl: GeoNames dumps  → /data/geonames   ┐ all baked at build
              • prefetch CLIP weights → /data/models      ┘ (retry+backoff on flaky CDN)
                        │
                        ▼
              `docker run --network none` still loads & embeds → air-gapped
```

The CLIP weights, GeoNames data, and tesseract are all baked into the image, so
the running enrichment service needs no network. MeiliSearch telemetry is
disabled (`MEILI_NO_ANALYTICS`). Do **not** mount a volume over `/data/models`
at runtime, or the baked weights are shadowed. Overriding `EMBED_MODEL` at
runtime re-introduces a one-time download.

## Removing the feature

It is intentionally removable: delete `routes/enrich.js` (and its mount in
`app.js`), the `frontend/pages/{map,search}.js` pages and their navbar links,
and the `rpg-enrichment-indexer`/`rpg-redis`/`rpg-meilisearch` services from
`docker-compose.yml`. The gallery is unaffected.
