# video-enrichment

Bring video files into the enrichment plane: discover them, extract their
embedded location, capture date, and technical metadata via `ffprobe`, and render
them on the map — so videos are findable by date and visible on the map
alongside photos. Location is optional, exactly as for images.

## ADDED Requirements

### Requirement: Video file discovery
The enrichment walker SHALL discover video files (`.mov`, `.mp4`, `.m4v`,
`.webm`) in addition to images, so each video becomes a content-hashed document
with the same base fields as an image (`path`, `album`, `mime_type`, `file_size`,
`last_modified`). The video's `mime_type` SHALL be a `video/*` type. Image-only
enrichers (`ocr`, `visual`, `caption`) SHALL NOT run on videos.

#### Scenario: Video becomes a document
- **WHEN** a reconcile walk encounters a `.mov`/`.mp4`/`.m4v`/`.webm` file
- **THEN** the file is enqueued and a document is created with base fields and a `video/*` `mime_type`

#### Scenario: Image-only enrichers skip video
- **WHEN** the pipeline processes a video document
- **THEN** the `ocr`, `visual`, and `caption` enrichers are skipped and record no output or error for it

#### Scenario: Video participates in delta and reap
- **WHEN** a video is unchanged on a delta scan, or deleted from disk on a reap
- **THEN** it is skipped (delta) or its document is removed (reap) by the same path/stat logic used for images

### Requirement: Video embedded-metadata extraction
The `geo` enricher SHALL, for a video, read embedded metadata via `ffprobe`
(invoked as a subprocess; no new npm dependency) and write `_geo { lat, lng }`
when GPS is present, `taken_at` (capture date), `duration` (seconds), and the
video's `width` and `height`. A single `ffprobe` invocation SHALL supply all of
these. Absent GPS SHALL be treated as a normal condition (no `_geo`, no error),
matching image behavior.

#### Scenario: Video with GPS
- **WHEN** the geo enricher processes a video whose container metadata contains a location atom
- **THEN** it writes `_geo`, `taken_at`, `duration`, `width`, and `height`

#### Scenario: Video without GPS
- **WHEN** a video has no embedded location
- **THEN** no `_geo` field is written, no error is recorded, and `taken_at`/`duration`/`width`/`height` are still written when present

#### Scenario: Capture-date precedence
- **WHEN** a video carries both a timezone-aware Apple creation date and a plain `creation_time`
- **THEN** `taken_at` is derived from the timezone-aware Apple creation date

#### Scenario: Reverse-geocoding reuse
- **WHEN** a video document has `_geo` coordinates
- **THEN** searchable place text is derived from the same offline GeoNames path used for images, with no outbound network call

### Requirement: Video location source labeling
The enricher SHALL label a video's auto-extracted location with
`geo_source: "quicktime"`, distinct from the image value `"exif"`. The
`geo_source` vocabulary SHALL be `manual | exif | quicktime | inferred`, and the
re-scan clobber protection SHALL continue to apply only to `manual`.

#### Scenario: Video location is labeled quicktime
- **WHEN** the geo enricher assigns a location to a video from its embedded metadata
- **THEN** `geo_source` is set to `"quicktime"` (not `"exif"`)

#### Scenario: Manual override on a video is preserved
- **WHEN** a reconcile scan processes a video whose location was set manually
- **THEN** the enricher leaves the manual `_geo` and `geo_source` unchanged

### Requirement: Video rendering on the map
The map lightbox SHALL render a video document as a playable video slide rather
than an image, keyed off the document's `video/*` `mime_type`.

#### Scenario: Clicking a video pin
- **WHEN** a user opens a map marker whose document `mime_type` is `video/*`
- **THEN** the lightbox presents a playable video rather than attempting to load the file as an image
