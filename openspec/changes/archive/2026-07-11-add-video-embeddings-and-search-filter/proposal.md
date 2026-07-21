# Proposal: add-video-embeddings-and-search-filter

## Why

Videos are indexed by the enrichment plane (geo/date/duration via the archived
`add-video-enrichment` change) but carry no `_vectors` and no OCR text, so they
score ~0 on the semantic half of hybrid search and are cut by the ranking-score
threshold — invisible to smart search and semantically un-clusterable next to
photos (TODO Video #2, Search & lightbox #2). Separately, there is no way to
keep videos out of a search result set when the user only wants photos.

## What Changes

- The `visual` enricher gains a video branch: extract 3 keyframes (20/50/80% of
  duration) via ffmpeg pipes, CLIP-embed each frame, embed a text string of
  `place + filename` in the same shared space, and store all of them as a
  MeiliSearch **multi-vector** (`_vectors.image = [frame×3, text]`, max-sim
  ranking). Zero-shot tags are derived from the mean-pooled frame vector, so
  videos get keyword-recall tags like photos.
- The `ocr` enricher gains a video branch: OCR the same 3 keyframes (shared
  per-file extraction memo), dedupe recognized lines across frames, and write
  the result to the standard `content` field.
- New shared `enrichment/src/lib/video-frames.js`: ffprobe duration + piped
  PNG frame extraction (~1280px long edge), subprocess timeouts, single-entry
  per-file memo so OCR and visual share one extraction.
- `/search` accepts an `excludeVideos` flag (precedent: `excludeInferred`) that
  filters `NOT mime_type IN [<video MIME types from rpg-media-types>]`;
  `mime_type` becomes a filterable attribute, and docs indexed before the field
  existed are backfilled on scan via the existing canonical-path stat-refresh.
- Search page gains a "hide videos" toggle (default off — videos included, i.e.
  current behavior), persisted through the URL like the smart toggle.
- No enricher version bumps: videos have never been stamped by `visual`/`ocr`,
  so widening `applies()` enqueues them naturally while all existing image docs
  stay current (no mass re-embedding).

## Capabilities

### New Capabilities

- `video-keyframe-embeddings`: videos get CLIP visual embeddings (multi-vector:
  per-keyframe + metadata-text) and zero-shot tags, making them rankable in
  hybrid/smart search alongside photos.
- `video-frame-ocr`: text visible in video keyframes is OCR'd, deduplicated
  across frames, and keyword-searchable via the standard `content` field.
- `video-search-filter`: search results can exclude videos via an API flag and
  a persisted search-page toggle, backed by a filterable `mime_type` field
  (including backfill of pre-existing docs).

### Modified Capabilities

<!-- none: media-discovery (registry/walker) is unchanged; enrichment-stage and
     search-endpoint behavior added here has no existing spec -->

## Impact

- **Enrichment**: `enrichers/visual.js`, `enrichers/ocr.js` (applies widened to
  `MEDIA_FORMAT_REGEXP` + video branches), new `lib/video-frames.js`,
  `lib/pipeline.js` (one-line `mime_type` backfill), `lib/meili.js`
  (filterable `mime_type`), `routes/enrichment-api.js` (`excludeVideos`).
- **Frontend**: `gallery/frontend/pages/search.js` (toggle + body param + URL
  persistence).
- **Pipeline machinery unchanged**: `embeds`/`embeddingLost`/`needsEmbedOptOut`
  already handle the multi-vector `{embeddings}` shape; force re-scan, delta,
  and reap apply to video docs as-is.
- **Risk to de-risk first**: Meili v1.47 must accept the multi-vector array
  form for the configured `userProvided` embedder and rank by best-matching
  vector — spike task before building on it (this plane has a history of
  silent whole-task vector rejections).
- **Deploy**: rebuild the enrichment image (ffmpeg — also closes the archived
  Block 1 §7 acceptance gap), then scan; ~20–30s/video background cost on the
  prod CPU is acceptable for a library of hundreds of videos.
