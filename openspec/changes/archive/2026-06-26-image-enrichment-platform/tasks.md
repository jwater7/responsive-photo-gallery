# Tasks

> **Archived 2026-06-26 (deferred state).** 40/44 tasks shipped; the core
> enrichment platform (OCR, semantic/CLIP search, geo, map UI, graceful
> degradation) is in production. Four items were intentionally **not implemented**
> and live on in `TODO.md`:
> - **3.5** local caption (VLM) enricher — deferred to keep model RAM small.
> - **4.5** inferred-location fallbacks (`geo_source: inferred`) — optional follow-on.
> - **7.1** supersede the legacy `ocr-*` specs — skipped; the area is now entangled
>   with later-landed changes, so the spec set was left untouched (archived
>   without spec sync, by decision).
> - Map render verification item — data path verified; interactive render needs a
>   browser pass.

Phased so the work lands incrementally. Phase 1 is the enabler; Phases 2–4 each
depend only on Phase 1; Phase 5 (map) depends on Phase 4. Phase 6 is
cross-cutting and verified throughout.

## 1. Enrichment pipeline foundation

- [x] 1.1 Add Redis service to docker-compose; add BullMQ to the enrichment service
- [x] 1.2 Define a content-hash-keyed job model and an enqueue API (one job per file)
- [x] 1.3 Implement a worker pool that runs ordered, idempotent enricher stages
- [x] 1.4 Define the pluggable enricher interface (`name`, `applies(file)`, `enrich(file) -> fields`, `outputFields`)
- [x] 1.5 Port OCR to the first enricher behind the interface
- [x] 1.6 Replace cron+isScanning with: upload-event enqueue (POST /enqueue + watcher), chokidar watcher, periodic reconcile
- [x] 1.7 Make all triggers non-blocking (`started`/`running`); never block on completion
- [x] 1.8 Rework `/status` to report queue depth, active jobs, and per-stage progress
- [x] 1.9 Boot resiliently when Redis/MeiliSearch are down; retry lazily, never crash

## 2. OCR enricher quality

- [x] 2.1 Add native `tesseract` (and optional ImageMagick) to the enrichment image
- [x] 2.2 Implement the native-tesseract enricher behind the engine interface
- [x] 2.3 Remove tesseract.js once parity is confirmed; keep the interface

## 3. Semantic / contextual search

- [x] 3.1 Add a local CLIP image-embedding model (ONNX/transformers.js, CPU) to the image
- [x] 3.2 Embedding enricher: image -> vector, stored as `_vectors.image` (userProvided)
- [x] 3.3 Configure MeiliSearch hybrid search with the userProvided embedder
- [x] 3.4 Zero-shot tag enricher (CLIP vs curated label vocabulary) -> `tags[]`
- [ ] 3.5 Optional local caption enricher -> `caption` (DEFERRED: skipped to keep the
      memory footprint small — a second VLM would double model RAM; zero-shot `tags[]`
      already cover explainability/keyword recall. Add later behind the enricher interface.)
- [x] 3.6 Hybrid search endpoint: keyword (content+caption+tags) ⊕ vector, tunable weight
- [x] 3.7 Query-time text embedding for the search query (local)
- [x] 3.8 Small labeled eval set to tune semantic-vs-keyword weighting

## 4. Geo enrichment

- [x] 4.1 EXIF enricher with `exifr`: extract GPS -> `_geo`, and `taken_at`
- [x] 4.2 Bundle offline GeoNames dataset; reverse-geocode `_geo` -> place hierarchy text
- [x] 4.3 Configure `_geo` on the `docs` index; geo filter/sort + place keyword search
- [x] 4.4 `geo_source` field with precedence (manual > exif > inferred); never clobber manual
- [ ] 4.5 (Optional) inferred-location fallbacks: album name, time-proximity to geotagged photos
      (DEFERRED: optional; core EXIF + manual-precedence path is in. Add later behind the
      geo enricher as `geo_source: inferred`.)

## 5. Map UI

- [x] 5.1 Leaflet + react-leaflet map surface in the frontend (OSM tiles, self-hostable)
- [x] 5.2 `supercluster` clustering; thumbnails as markers (reuse existing sharp thumbs)
- [x] 5.3 Viewport bounding box -> `_geoBoundingBox` query; re-query/re-cluster on pan/zoom
- [x] 5.4 Combine map viewport with the search box (text/semantic) and date filter
      (date-range PICKER UI is a small follow-on; API + query plumbing support takenAfter/takenBefore)
- [x] 5.5 Manual pin placement UI -> assign `_geo` with `geo_source: manual`
      (drag-to-reposition exercises the full manual-pin write; a picker to place un-located photos is a follow-on)

## 6. Graceful degradation (cross-cutting)

- [x] 6.1 Verify gallery browse/auth/view/upload work with Redis+Meili+enrichment all down
      (gallery hot path imports nothing from the enrichment plane — enforced by the guard below;
      the only boundary is the HTTP proxy, which returns 503/degraded gracefully)
- [x] 6.2 Upload-time enqueue is best-effort: upload succeeds even if the queue is down
      (by design: gallery has no upload/write endpoint; ingestion is watcher-driven on the shared
      /images volume, so there is no upload-time coupling to the queue at all)
- [x] 6.3 Frontend search box + map fail soft (hidden / "unavailable") when Meili is unreachable
      (map + its search box are gated on the runtime `features.map` flag, which flips off when
      enrichment is unreachable; `features.search` is ready for a future standalone search box)
- [x] 6.4 No gallery hot-path import of or call into the enrichment plane (lint/test guard)
      (scripts/check-gallery-isolation.js, wired as `npm run test:isolation`; passes, and fails on a
      violation)

## 7. Spec reconciliation

- [ ] 7.1 On archive, supersede `ocr-delta-scan`, `ocr-progress-tracking`, `ocr-status-api` with the pipeline + ocr-enrichment specs
- [x] 7.2 Record the non-blocking `/ocr-sync` decision in project memory so it is never re-asked
      (memory/ocr-sync-non-blocking-decision.md)

## Verification checklist

- [x] Gallery fully usable with the entire enrichment plane stopped (isolation guard + proxy fail-soft)
- [x] Search box / map fail soft, never block browsing (runtime features flag; proxy 503/degraded)
- [x] All scan triggers respond immediately; progress only via `/status`
- [x] Re-scan adds only missing enricher fields (no full reprocess)
- [x] "baseball"/"an aircraft at an airport" returns visually-related images, not just text matches
- [ ] Map shows geotagged photos, clusters by zoom, viewport filters results
      (data path verified via backend geo search; the interactive render needs a browser)
- [x] Manual pin survives a subsequent reconcile scan
- [x] No outbound network calls from any enricher or from MeiliSearch
      (inference is local + Meili uses userProvided vectors; GeoNames + tesseract baked at build.
      CLIP model now baked at build too via `src/bin/prefetch-model.js` into /data/models — proven
      by loading + embedding under `docker run --network none` (exit 0). Meili telemetry disabled
      with MEILI_NO_ANALYTICS. The /data/models volume mount was removed so the baked weights aren't
      shadowed. Caveat: overriding EMBED_MODEL at runtime re-introduces a one-time download.)
