## 1. Container: ffmpeg

- [x] 1.1 Add `ffmpeg` to the `apt-get install` line in `enrichment/Dockerfile` (provides `ffprobe`). NOTE: rebuilding the image + confirming `ffprobe -version` in the indexer/worker containers is a deploy-time step (see §7).
- [x] 1.2 Add a one-line note to the Security TODO / Dockerfile comment that ffmpeg lands in both API + worker images and adds CVE surface, accepted because the plane is internal-only

## 2. Discovery: walker + MIME

- [x] 2.1 In `enrichment/src/lib/walk-dir.js`, add `VIDEO_FORMAT_REGEXP` (`mov|mp4|m4v|webm`), keep `SUPPORTED_FORMAT_REGEXP` image-only, and make the walker collect files matching image OR video; export `VIDEO_FORMAT_REGEXP`
- [x] 2.2 In `enrichment/src/lib/hash.js`, add video entries to `MIME_BY_EXT` (`.mov`→`video/quicktime`, `.mp4`→`video/mp4`, `.m4v`→`video/x-m4v`, `.webm`→`video/webm`)
- [x] 2.3 In `enrichment/src/bin/worker.js`, widen the watcher's regexp test to image OR video (off in prod, but keep it correct)

## 3. Video metadata library

- [x] 3.1 Create `enrichment/src/lib/video-meta.js` that runs `ffprobe -v quiet -print_format json -show_format -show_streams <file>` via `child_process.execFile` and parses the JSON once
- [x] 3.2 Parse capture date with precedence `com.apple.quicktime.creationdate` (timezone-aware) over `creation_time`; return as a Date/ISO
- [x] 3.3 Add an ISO6709 parser for `com.apple.quicktime.location.ISO6709` → `{ lat, lng }`
- [x] 3.4 Return `{ gps, takenAt, duration, width, height }` (duration in seconds; dims from the first video stream); handle a missing/failed probe by throwing or returning a clear empty result

## 4. Geo enricher: video branch

- [x] 4.1 In `enrichment/src/enrichers/geo.js`, widen `applies` to image OR video (`SUPPORTED_FORMAT_REGEXP || VIDEO_FORMAT_REGEXP`)
- [x] 4.2 Branch `enrich()` by extension: keep the exifr path for images untouched; for video call `video-meta.js`
- [x] 4.3 For video, write `_geo` (when GPS present), `taken_at`, `duration`, `width`, `height`; absent GPS writes no `_geo` and records no error
- [x] 4.4 Set `geo_source: "quicktime"` for an auto-extracted video location; keep the `manual` clobber guard unchanged
- [x] 4.5 Reuse the existing offline `geonames.reverse()` path for video coordinates (place text), unchanged
- [x] 4.6 Update the `geo.js` header comment + `geo_source` doc to the vocabulary `manual | exif | quicktime | inferred`

## 5. Frontend: map video playback

- [x] 5.1 In `gallery/frontend/components/map/MapView.js`, make `toSlide` return a video-type slide when the doc `mime_type` starts with `video/` (so the lightbox plays it instead of loading an `<img>`)
- [x] 5.2 Verify a video marker's poster/thumb still renders (degrade gracefully if no gallery thumbnail exists, given the `.m4v`/`.webm` album-side gap)

## 6. Tests

- [x] 6.1 Walker test: a directory with mixed image + video files yields both, with correct `mime_type`; excluded dirs still skipped
- [x] 6.2 `video-meta.js` test: ISO6709 parsing, capture-date precedence (Apple over creation_time), and graceful handling of a probe with no location
- [x] 6.3 geo enricher test: video with GPS writes `_geo` + `geo_source: "quicktime"` + `taken_at` + `duration` + dims; video without GPS writes no `_geo` and no error; manual location is preserved on re-scan
- [x] 6.4 Pipeline test: a video document is skipped by `ocr`/`visual`/`caption` (no output, no error) and enriched only by `geo`

## 7. Verification (live stack — deferred to deploy)

> Automated coverage is in place (enrichment suite 55/55, incl. a real-ffprobe
> integration test). The steps below require the running stack + real video data
> and a rebuilt enrichment image (`ffmpeg`), so they are acceptance steps to run
> on deploy, not in this implementation pass.

- [ ] 7.1 Run a full scan against a sample library containing geotagged + non-geotagged videos; confirm video documents appear in the index with expected fields
- [ ] 7.2 Confirm geotagged videos appear as pins on the map and open as playable video; confirm videos are returned/sorted by `taken_at` (date) search
- [ ] 7.3 Confirm a delta scan skips unchanged videos and reap removes a deleted video's document
