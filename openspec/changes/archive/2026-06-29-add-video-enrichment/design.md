## Context

The enrichment plane (walker → BullMQ queue → worker → per-file pipeline →
MeiliSearch) only handles images. The walker's `SUPPORTED_FORMAT_REGEXP`
(`jpe?g|png|tiff?|bmp|webp`) is image-only, so videos never become documents; and
all four enrichers (`ocr`, `visual`, `geo`, `caption`) independently gate their
`applies(file)` on that same regexp. The gallery's *album* plane already handles
video (poster frames + date grouping via `ffprobe` in
`packages/fast-image-processing`), but the enrichment store has zero video
presence — so videos are absent from the map and date search.

Two facts constrain the design:
- The enrichment container has **no ffmpeg/ffprobe** today (only tesseract +
  imagemagick) and its only metadata lib is `exifr`, which reads EXIF/XMP, not
  the QuickTime `moov`/`udta` atoms where a video's GPS and creation date live.
- The prod host (FX-6300, 7.7 GB RAM, swap already full) makes a second
  CLIP-loading worker process expensive — loading the model twice is a real
  memory cost. This argues against splitting video into its own worker now.

The pipeline already supports incremental, per-enricher "append on rescan":
`isCurrent(doc, enricher)` skips a stage only when its output fields are present
and `<name>_version` is current, so a new enricher (or a bumped version)
backfills existing docs on the next full scan with no migration.

## Goals / Non-Goals

**Goals:**
- Videos become enrichment documents and get location, capture date, duration,
  and dimensions.
- Videos appear on the map and are searchable/sortable by `taken_at` (date/year).
- Keep the change minimal while honoring existing architectural patterns.
- Lay forward-compatible groundwork (ffmpeg present) for later frame-based blocks.

**Non-Goals:**
- No video CLIP embeddings, OCR-on-frames, or keyframe extraction (future blocks).
- No separate video worker process or second queue.
- No video transcoding / rendition pipeline (that is Video #1 in TODO).
- No new search UI (e.g. a "videos only" filter) — videos simply participate in
  existing date search and the map.

## Decisions

### Decision: One worker, one queue — `applies()` is the dispatcher
Videos flow through the **existing** queue and worker. No `type` field is added to
the job and no second queue is created. Routing already exists as the per-enricher
`applies(file)` check: the walker emits both images and videos; `geo.applies`
widens to image-or-video; `ocr`/`visual`/`caption` keep the image-only regexp and
therefore skip videos by construction.

- **Why:** This is the smallest change that is also idiomatic — the dispatcher the
  earlier design sketch wanted is already present. A single worker keeps one CLIP
  model loaded (critical on the swap-bound prod box).
- **Alternatives considered:** (a) Type-tagged single queue + in-process
  dispatcher — adds a field and a routing layer for no benefit, since `applies()`
  already selects. (b) Separate `enrichment-video` queue + video worker container —
  true process isolation, but doubles CLIP memory once frame embedding lands and
  adds infra (2nd container, 2-queue `/status` aggregation) for a workload whose
  only current job is a single `ffprobe` read. Deferred until keyframe
  tokenization justifies the weight; splitting later is a localized change.

### Decision: Path A — add `ffmpeg` to the shared enrichment image
Install `ffmpeg` (which provides `ffprobe`) via `apt` in `enrichment/Dockerfile`.

- **Why:** The video metadata isn't reachable with the current image. ffmpeg is
  the same tool the gallery plane uses and is forward-compatible: later
  frame-based blocks (CLIP/OCR on keyframes) need the encoder anyway. Debian ships
  `ffprobe` only inside the `ffmpeg` package, so there is no slimmer option, and
  no weight is wasted.
- **Trade-off:** The API and worker containers build from the *same* Dockerfile,
  so ffmpeg lands in both. Accepted: the plane is internal-only (consistent with
  the Security TODO's existing note on the Debian CVE surface). Splitting the
  image is possible later but rejected now as non-minimal.
- **Alternatives considered:** (B) A pure-JS QuickTime atom parser — truly minimal
  and no binary/CVE surface, but a dead-end for the frame-based blocks and a
  throwaway. (C) Have the gallery (which has ffmpeg) write video geo into Meili —
  breaks the deliberate "album-build never touches the enrichment store"
  separation and creates two writers to one index.

### Decision: Extract via a thin `ffprobe` subprocess wrapper, no npm dep
A new `enrichment/src/lib/video-meta.js` runs
`ffprobe -v quiet -print_format json -show_format -show_streams <file>` via
`child_process.execFile`, parses the JSON once, and returns
`{ gps, takenAt, duration, width, height }`. It includes a small ISO6709 →
`{ lat, lng }` parser for the `com.apple.quicktime.location.ISO6709` atom.

- **Why:** Avoids adding `fluent-ffmpeg` (a dependency used on the gallery side
  but unnecessary here). One probe supplies every field the geo branch needs.
- **`taken_at` precedence** mirrors the gallery's `renderVideoCell`: the
  timezone-aware `com.apple.quicktime.creationdate` is preferred over the
  (usually UTC) `creation_time`, so a clip's *local* year is correct for date
  search — and the map/date grouping stay consistent with the album view.

### Decision: `geo_source: "quicktime"` for video, not `"exif"`
The location-source vocabulary becomes `manual | exif | quicktime | inferred`.

- **Why:** `"exif"` would be factually wrong for a QuickTime container. The value
  is shown verbatim to users in `ImageMeta.js`, so it must be accurate. The source
  standard (`quicktime`) is named rather than the reader (`ffprobe`): it parallels
  `"exif"` (both name an embedded-metadata standard, not a tool) and survives a
  future swap of the reader (e.g. a JS atom parser) without the stored provenance
  becoming a lie.
- **Blast radius (verified):** only one consumer reads the *value* —
  `ImageMeta.js:136` (renders `(geo_source)`). The clobber guard
  (`geo.js:35`) only checks `=== "manual"`, and the coverage stat
  (`enrichment-api.js:351`) counts field *presence*, so both are value-agnostic.
- **Alternatives considered:** `"iso6709"` (more precise — the exact atom — but
  cryptic in the UI); `"ffprobe"` (names the reader, breaks the taxonomy and lies
  if the reader changes).

### Decision: `duration`/`width`/`height` live on the `geo` enricher's output
The `geo` enricher is already the de-facto "embedded file metadata" stage — it
writes `taken_at`, not just location. Its video branch additionally writes
`duration`, `width`, `height` from the same single probe.

- **Why:** Avoids a second `ffprobe` pass or a second enricher for one extra
  field group, and is consistent with `geo` already reaching beyond pure location.
  `duration` + dims also feed the future Video #1 rendition-sizing question at no
  extra cost. Stored only (not sortable/filterable) for now; can be promoted later
  if "long videos" search is ever wanted.
- **Alternative considered:** A dedicated `video-meta` enricher — cleaner
  separation but adds an enricher and risks a duplicate probe; deferred.

## Risks / Trade-offs

- **ffmpeg CVE surface in the API image** → Internal-only plane; documented next
  to the existing Security TODO note. Image can be split later if it matters.
- **`ffprobe` failure / corrupt or exotic container** → The geo branch records a
  soft error (`geo_error`) and writes no `_geo`, exactly like a probe-less image;
  the pipeline retries on the next scan and other stages are unaffected.
- **`.m4v`/`.webm` consistency on the gallery side** → The album plane's
  `isVideo()` only recognizes `.mov`/`.mp4`, so `.m4v`/`.webm` are accepted then
  silently dropped during album build (a pre-existing bug, see TODO Video #2
  notes). The enrichment walker will index all four; the map slide should not
  assume a gallery thumbnail exists for every video. Out of scope to fix the
  gallery bug here, but flagged so the map rendering degrades gracefully.
- **`geo_source` precedence ladder** → `manual` stays protected; a video re-scan
  rewrites `quicktime` idempotently. No change to the manual-override endpoint.

## Migration Plan

- No data migration. After deploy, a **full** scan creates video documents and
  the per-enricher append model backfills `_geo`/`taken_at`/`duration`/dims onto
  any video that is later re-scanned. A delta scan picks up new videos going
  forward.
- Rollback: revert the code and the Dockerfile ffmpeg line. Existing video
  documents in the index are harmless if left (they carry only standard fields);
  a reap is not required.

## Open Questions

- None blocking. (`geo_source` value, duration/dims capture, and the
  single-worker topology were all resolved during exploration.)
