## Context

The OCR service was just refactored into a single, working microservice
(one entry point, real tesseract.js OCR, delta scanning keyed by content hash,
MeiliSearch as the index). This change builds directly on that foundation and
generalizes it: OCR stops being *the* feature and becomes *one enricher* among
several (OCR, caption/tags, semantic embedding, geo), all feeding one document
and one hybrid query.

The defining constraint is isolation: the main gallery must be fully functional
with the entire enrichment plane offline. That makes every decision below answer
to "does this keep the gallery independent and the features fail-soft?"

## Goals / Non-Goals

**Goals**

- One hash-keyed document enriched along independent axes: what it says (OCR),
  what it shows (caption/embedding/tags), where it was taken (geo), when (time).
- Durable, restart-safe, event-driven enrichment with non-blocking triggers.
- One hybrid query: keyword ⊕ vector ⊕ geo ⊕ time, all in MeiliSearch.
- A Leaflet map where the viewport is the query.
- 100% local: no image or model ever leaves local infra.
- Gallery independence + fail-soft search/map.

**Non-Goals**

- Any cloud dependency (OCR, embeddings, captions, geocoding, map tiles).
- Coupling the gallery's hot path to enrichment.
- A separate vector or geo datastore.
- Real-time inference; enrichment is background batch.

## Architecture

```
  ┌──────────────────────────────────────────────────────────────┐
  │ GALLERY PLANE (must always work)                              │
  │   Express API + Next.js · JWT auth · sharp/ffmpeg thumbs      │
  │   depends only on: its mongo + the filesystem                 │
  │   on upload: fire enqueue event (best-effort, non-blocking) ──┼──┐
  └──────────────────────────────────────────────────────────────┘  │
                                                                     │ (optional)
  ┌──────────────────────────────────────────────────────────────┐  │
  │ ENRICHMENT PLANE (optional; degrades to off)                  │◀─┘
  │                                                               │
  │   Redis/BullMQ queue                                          │
  │      │  jobs keyed by content hash, idempotent                │
  │      ▼                                                        │
  │   discover → hash → [ enrichers ] → index                     │
  │                       ├ ocr        (native tesseract)         │
  │                       ├ caption/tags (local CLIP/VLM)         │
  │                       ├ embedding   (local CLIP → vector)     │
  │                       └ geo         (exifr → offline geocode) │
  │                                         │                     │
  │   images (read-only) ───────────────────┘                     │
  │   writes → MeiliSearch `docs` (text + vector + _geo)          │
  └──────────────────────────────────────────────────────────────┘
```

### Document shape (one per content hash)

```
  hash (pk)
  album, path, mime_type, file_size, last_modified      ← existing
  content                                                ← ocr
  caption, tags[]                                         ← visual
  _vectors.image <float[]>                                ← embedding (userProvided)
  _geo {lat,lng}, place{poi,city,region,country}, geo_source ← geo
  taken_at                                                ← geo/exif
```

Each enricher owns its fields and writes only them (partial upsert). Re-scan
skips an enricher whose output for that hash already exists, so adding a new
enricher only backfills the missing field — it never reprocesses everything.

### Query surface

```
  "baseball near Boston, summer 2022"
     vector(baseball) ⊕ _geoBoundingBox(Boston) ⊕ filter(taken_at 2022-06..08)
                       └────────── one MeiliSearch hybrid query ──────────┘
```

## Locked Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **`/ocr-sync` is non-blocking — FINAL** | Scans run minutes–hours; blocking guarantees client timeouts and duplicate work on retry. Return `started`/`running`, poll `/status`. See below. |
| 2 | OCR via **native `tesseract`** (not tesseract.js) | Measurably better extraction; engine stays behind a pluggable interface. |
| 3 | **No cloud, all local** | Privacy + self-containment. Accept lower model capability. |
| 4 | **MeiliSearch** for keyword + vector + geo | One backend unifies all three; no separate vector/geo store to operate. |
| 5 | Embeddings are **`userProvided`** | We run the model locally and pass vectors in; Meili never makes outbound calls. |
| 6 | Queue: **Redis + BullMQ** | Durable, restart-safe, retries, parallel workers; proportionate (not Kafka). |
| 7 | Reverse geocoding: **offline GeoNames** | No network calls; city/region/country granularity. Self-hosted Nominatim is a future option for POI. |
| 8 | Map: **Leaflet** + OSM tiles + `supercluster` | Simple, well-trodden, self-hostable tiles. |
| 9 | Gallery is **independent**; search/map **fail soft** | The hard constraint; verified by the graceful-degradation spec. |

### Decision 1 in full — `/ocr-sync` (and all scan triggers) are non-blocking

**This is settled. Do not re-open it.** Any endpoint that starts enrichment work
returns immediately:

- idle → start in background, respond `{ status: "started", type }`
- already running → respond `{ status: "running" }`, start nothing new

Progress and final stats are observed via `GET /status`, never by holding the
request open. The earlier specs contradicted themselves (one said "respond
immediately", another showed returning completion stats); the completion-stats
behavior is **rejected**. Rationale: a scan can take hours, far exceeding any
reasonable HTTP timeout; a client that retries a "hung" blocking call causes
duplicate scans. Fire-and-forget + status polling is the standard pattern for
long-running jobs and is what we implement everywhere.

## Resilience & Graceful Degradation

The gallery plane and enrichment plane share only the **read-only image volume**.

- The gallery imports nothing from the enrichment service and calls no
  enrichment/search/Meili endpoint on any request needed to browse, authenticate,
  view, or upload. Upload-time enqueue is best-effort: if Redis is down, the
  upload still succeeds and reconcile picks the file up later.
- The frontend treats search and map as **optional surfaces**. If MeiliSearch is
  unreachable, the search box and map degrade (hidden or "search unavailable")
  and browsing is unaffected.
- The enrichment service boots even when MeiliSearch/Redis are down and retries
  lazily; it never crashes the process over a missing dependency.

## Risks / Trade-offs

- **CPU-only inference latency** — CLIP/caption on CPU is hundreds of ms–seconds
  per image. Acceptable as one-time background batch; mitigated by queue
  parallelism and hash-keyed skip. Not for interactive use.
- **Local model quality** — accepted explicitly; pluggable so a better local
  model can drop in later.
- **Image volume / model cache size** — embeddings (~KB/image) and model/geo
  datasets add storage; bounded and on dedicated volumes.
- **Index migration** — `docs` gains vector + `_geo` config; existing docs need a
  backfill pass (handled by reconcile; no data loss since hash is the key).
- **Manual geo vs re-scan** — manual pins must never be clobbered by the EXIF
  enricher; resolved via `geo_source` precedence (manual > exif > inferred).
- **Scope** — this is a large umbrella change by request; tasks.md phases it so
  it can land incrementally behind the pipeline foundation.
