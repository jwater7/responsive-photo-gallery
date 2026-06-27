# Why

The photo gallery can index OCR text from images, but that is the floor of what
the collection could be searchable by. We want to find images by what they
*show* (semantic/contextual search — "baseball" surfacing mitts, bats, and
stadiums), by *where they were taken* (geo search and a browsable map), and by
*when* — not just by text printed inside them.

Rather than bolt three unrelated features onto the OCR service, this change
generalizes it into a single **image enrichment platform**: a durable,
event-driven pipeline whose stages (enrichers) each add fields to one
content-hash-keyed document, all queryable together through one hybrid search.

**Hard constraint driving the whole design:** the main gallery app must keep
working — browse, auth, thumbnails, upload — even when *all* of this
infrastructure (MeiliSearch, Redis, the enrichment service, the local models)
is down. Enrichment and search are strictly *additive and optional*. They never
sit on the gallery's hot path.

**No cloud, ever.** Every image and every model stays on local infrastructure.
We accept that local models may be less capable than hosted ones; privacy and
self-containment win.

---

# What Changes

## Foundation — enrichment pipeline (enabler)

- Replace the in-memory `isScanning` flag + fire-and-forget cron with a durable
  job queue (**Redis + BullMQ**). Jobs survive restarts, retry with backoff, and
  expose per-file/per-stage progress.
- Become **event-driven**: the gallery enqueues an enrichment job on upload; a
  filesystem watcher (**chokidar**) catches out-of-band changes; the periodic
  delta scan becomes a *reconcile* safety net.
- Generalize "extract" into **pluggable enricher stages** keyed by content hash
  and idempotent (skipped on re-scan). OCR becomes the first enricher.
- **Settle `/ocr-sync` once and for all: non-blocking.** It returns immediately
  (`started` / `running`); progress and final stats come from `/status`. See
  design.md — this decision is FINAL and must not be re-litigated.

## OCR enricher — quality upgrade

- Swap **tesseract.js for the native `tesseract` binary** (with optional
  ImageMagick preprocessing) in the enrichment image. Better extraction quality;
  engine kept behind a pluggable interface.

## Semantic / contextual search

- **Local CLIP-family image embeddings** (ONNX via transformers.js, CPU) so each
  image becomes a vector. Text queries embed into the same space.
- **Local zero-shot tags** (CLIP against a curated label vocabulary) and an
  optional local **caption** for explainability and keyword precision.
- **Hybrid search** in MeiliSearch: keyword (OCR + caption + tags) fused with
  vector similarity, with a tunable semantic weight. Embeddings are
  `userProvided` — we compute them locally and pass them in; Meili never calls
  out.

## Geo indexing + map

- **EXIF GPS extraction** (`exifr`) and `taken_at` timestamp as an enricher.
- **Offline reverse geocoding** (local GeoNames dataset) → place hierarchy
  (city/region/country) stored as searchable text. No network calls.
- Store coordinates in MeiliSearch's native **`_geo`** field for geo
  filter/sort.
- **Map UI** (**Leaflet** + OSM tiles, `supercluster` clustering) where the
  viewport bounding box *is* the query, plus **manual pin placement** for images
  without GPS.

## Graceful degradation (cross-cutting)

- Gallery has zero runtime dependency on the enrichment plane.
- Search box and map are additive UI surfaces that **fail soft** (hide or show
  "unavailable") when MeiliSearch is unreachable.

---

# Capabilities

### New

- **enrichment-pipeline** — durable, event-driven, hash-keyed pluggable enricher
  pipeline with non-blocking triggers and live status.
- **semantic-search** — local image embeddings, zero-shot tags/captions, and
  hybrid keyword+vector search.
- **geo-enrichment** — EXIF GPS + offline reverse geocoding + `_geo` indexing and
  geo/place text search.
- **map-ui** — Leaflet map surface with clustering, viewport-as-query, and manual
  location assignment.
- **graceful-degradation** — gallery independence and fail-soft search/map.

### Modified / superseded

- **ocr-enrichment** absorbs and supersedes the existing **ocr-delta-scan**,
  **ocr-progress-tracking**, and **ocr-status-api** specs (delta scanning,
  progress, and status now belong to the generalized pipeline; OCR is one
  enricher).

---

# Impact

## Affected code

- `ocr/` — generalized from an OCR service into the enrichment service
  (pipeline, queue workers, enricher modules, local model loading).
- `frontend/` — new search and map surfaces (additive, fail-soft).
- Main gallery (`routes/`, upload path) — emits an enqueue event on upload; no
  synchronous dependency.

## Affected infrastructure (docker-compose)

- **Add Redis** (queue broker).
- Enrichment image gains native `tesseract`/ImageMagick, the local embedding/tag
  models, and the offline GeoNames dataset.
- New volumes: model cache, geo dataset, (optionally) self-hosted OSM tiles.
- MeiliSearch index `docs` gains `_geo`, vector/embedding config, and new
  filterable/searchable fields.

## Non-goals

- No cloud OCR, embedding, captioning, geocoding, or tiles.
- No change to gallery auth, browsing, or thumbnail behavior.
- No replacement of MeiliSearch with a separate vector/geo store (Meili unifies
  keyword + vector + geo).
- No real-time/streaming inference; enrichment is background batch work.
