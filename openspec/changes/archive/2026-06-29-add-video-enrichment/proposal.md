## Why

Video files (`.mov`, `.mp4`, `.m4v`, `.webm`) are completely invisible to the
enrichment plane: the walker's format regexp is image-only, so videos never
become MeiliSearch documents and get no location, capture date, or any other
enrichment. They therefore never appear on the map and can't be found by
date/year search, even though the source metadata (QuickTime GPS + creation
date) is sitting in the file. This is the first, smallest block of broader video
enrichment — chosen because location + date are cheap to extract (a single
`ffprobe` read) and immediately useful.

## What Changes

- The enrichment walker discovers video files in addition to images, so each
  video becomes a content-hashed document with base fields (path, album,
  `mime_type`, size, mtime) like an image.
- The existing `geo` enricher gains a video branch: for a video it reads
  embedded metadata via `ffprobe` (no new npm dependency — a thin `child_process`
  wrapper) and writes `_geo`, `taken_at`, `duration`, and video dimensions
  (`width`/`height`). Reverse-geocoding to place text reuses the existing offline
  GeoNames path unchanged.
- The location-source vocabulary gains a video value: `geo_source` becomes
  `manual | exif | quicktime | inferred`. A video's auto-extracted location is
  labeled `"quicktime"` (the embedded-metadata standard), **not** `"exif"`, which
  would be inaccurate. The clobber ladder still protects only `manual`.
- The image-only enrichers (`ocr`, `visual`, `caption`) are unchanged and
  correctly skip videos by construction — their `applies()` keeps using the
  image-only regexp. No job `type` field and no second queue are introduced;
  per-enricher `applies()` is the dispatcher.
- `ffmpeg` (which provides `ffprobe`) is added to the shared enrichment container
  image. Forward-compatible: the encoder is needed for later keyframe-based
  blocks (CLIP/OCR on video frames).
- The map lightbox renders a video document as a playable video slide instead of
  a broken image.

## Capabilities

### New Capabilities
- `video-enrichment`: Discovering video files in the enrichment plane and
  extracting their embedded location, capture date, and technical metadata
  (duration, dimensions) via `ffprobe`, so videos appear on the map and are
  searchable by date alongside photos.

### Modified Capabilities
<!-- None: the geo-enrichment / map-ui behavior being extended lives in an
     archived change, not a live spec, and no live spec's requirements change at
     the spec level. The new requirements are captured under video-enrichment. -->

## Impact

- **Enrichment code**: `enrichment/src/lib/walk-dir.js` (video regexp + walker),
  `enrichment/src/lib/hash.js` (video MIME map), `enrichment/src/enrichers/geo.js`
  (video branch + `geo_source` value), new `enrichment/src/lib/video-meta.js`
  (ffprobe wrapper + ISO6709 parser), `enrichment/src/bin/worker.js` (watcher
  regexp, off in prod but kept correct).
- **Container image**: `enrichment/Dockerfile` installs `ffmpeg`. Note the API
  and worker share this image, so `ffmpeg` lands in both; acceptable because the
  plane is internal-only (relates to the Security TODO's note on the Debian CVE
  surface).
- **Frontend**: `gallery/frontend/components/map/MapView.js` (video-aware
  lightbox slide). The `mime_type: video/*` base field drives video-vs-image
  rendering — no new doc field needed.
- **Index/data**: new doc values (`geo_source: "quicktime"`, `duration`,
  `width`, `height`) backfill onto existing/new video docs on the next scan via
  the pipeline's per-enricher version/append model — no migration.
- **Dependencies**: no new npm packages; one new system package (`ffmpeg`).
