# media-discovery Specification (delta)

## ADDED Requirements

### Requirement: Single media-type registry
The system SHALL define supported media formats exactly once, in a shared
in-tree package (`rpg-media-types`) exporting the image and video extension
sets, the type predicates (`isImage`, `isVideo`, `isMedia`), the
extension→MIME map, and filter regexps derived from those same sets. The
gallery album build, the gallery image handler, the enrichment walker and
hasher, and fast-image-processing SHALL all consume the registry; no consumer
SHALL maintain its own extension list, video special case, or MIME table.

#### Scenario: A format is added once
- **WHEN** a new extension is added to the registry's sets
- **THEN** album builds, `/list`/`/thumbnails`, enrichment scanning, MIME typing, and the sharp/ffmpeg render dispatch all recognize it with no other code change

#### Scenario: No per-consumer drift
- **WHEN** any consumer classifies a file as image or video
- **THEN** the classification comes from the registry predicates, so every plane agrees (e.g. `.m4v` is video everywhere, never image in one consumer and video in another)

### Requirement: Video formats render through the video pipeline
fast-image-processing SHALL dispatch rendering (thumbnails and sprite cells)
by the registry's `isVideo`, so every registry video format is decoded via
ffmpeg and never fed to the sharp image path. The gallery's video-thumbnail
cache path SHALL likewise be selected by the registry predicate, not a
hard-coded extension.

#### Scenario: .m4v sprite cell renders
- **WHEN** the album build renders a cell for an `.m4v` or `.webm` file
- **THEN** the frame is extracted via ffmpeg and the cell appears in the sprite sheet (previously sharp failed and the file was silently skipped)

#### Scenario: Video thumbs cache under video-thumbs
- **WHEN** a thumbnail is generated for any registry video format
- **THEN** it is cached under the album's `video-thumbs/` tree (previously only `.mov` was; `.mp4` thumbs landed under `thumbs/`)

### Requirement: One excludes-aware walker for all media enumeration
The system SHALL provide a single shared directory walker (in the media-types
package) that filters entries through the registry and skips directories per
an injected exclude predicate. Every plane that enumerates media files — the
album build, the gallery `/list`/`/thumbnails` handler, and enrichment
scanning — SHALL use it, supplying its own exclude source. A subtree excluded
by the admin exclude list SHALL be absent from every plane's results.

#### Scenario: Excludes honored by /list and /thumbnails
- **WHEN** an admin excludes a subtree and a client requests `/api/v1/list` or `/api/v1/thumbnails` for the containing album
- **THEN** files under the excluded subtree are absent from the response (previously the image handler's walker ignored excludes)

#### Scenario: Consistent traversal semantics
- **WHEN** any consumer walks a directory containing dot-entries or entries whose stat fails (e.g. broken symlinks)
- **THEN** those entries are skipped identically across all consumers

### Requirement: Per-plane format support is explicit and capability-aware
Format support SHALL be an explicit matrix, not an accident of separate lists:
metadata-only enrichment stages (geo, caption) SHALL accept every registry
image format; pixel-decoding consumers (visual, OCR, sprite/thumbnail
rendering of images) SHALL accept registry image formats gated by the actual
decoder capability of the running build, probed once at startup (e.g. sharp's
HEIF input support). A file skipped for lack of decoder capability SHALL be
skipped with a recorded reason, never silently, and SHALL be processed
automatically once a capable build runs.

#### Scenario: HEIC gets a map pin without HEIF decode support
- **WHEN** a `.heic` photo with GPS EXIF is scanned on a build whose sharp lacks HEIF input
- **THEN** the geo stage indexes its location and capture date, while visual/OCR skip it with a recorded reason instead of failing repeatedly

#### Scenario: Capability upgrade self-heals
- **WHEN** a later deployment's sharp build supports HEIF input
- **THEN** previously skipped `.heic` docs gain their visual/OCR stages on the next scan without manual intervention

### Requirement: Enqueue accepts every supported media format
The enrichment `/enqueue` endpoint SHALL validate the submitted path against
the full media regexp (images and videos) derived from the registry, matching
what the pipeline actually processes.

#### Scenario: Video enqueue accepted
- **WHEN** a client POSTs `/enqueue` with a `.mp4` path
- **THEN** the file is enqueued (previously rejected as an unsupported type by the image-only pattern)
