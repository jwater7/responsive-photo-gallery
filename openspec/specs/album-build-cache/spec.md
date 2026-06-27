# album-build-cache Specification

## Purpose
TBD - created by archiving change frontend-perf-and-prod-readiness. Update Purpose after archive.
## Requirements
### Requirement: Per-album build pass produces cached artifacts
The system SHALL provide a per-album build pass that walks the album's image files,
decodes each image once, and writes to a persistent FS cache: a collage cover image,
one or more date-grouped sprite sheets, and a manifest. Artifacts SHALL be written
atomically (write to a temp path, then rename) so a partially written artifact is
never served.

#### Scenario: Cold album build
- **WHEN** the build pass runs for an album with no cached artifacts
- **THEN** it writes `cover`, `sprites/<group>-<n>`, and `manifest.json` under that album's cache directory

#### Scenario: Atomic artifact writes
- **WHEN** an artifact is being written
- **THEN** readers either see the previous complete artifact or the new complete artifact, never a partial file

### Requirement: Manifest maps grid cells to images and sprite coordinates
The build pass SHALL produce a manifest that lists date groups (with display labels),
the sprite sheets, and for each cell the source image identity, the cell's sprite-sheet
coordinates, and the source image's oriented dimensions. The manifest SHALL be
sufficient for a client to render the grid, map a cell to its sprite-sheet crop, and
resolve a cell to its full-size image without an additional metadata fetch.

#### Scenario: Manifest is self-sufficient for rendering
- **WHEN** a client reads the manifest
- **THEN** it can render every cell, locate each cell within its sprite sheet, and link each cell to a full-size image

#### Scenario: Date groups derived from EXIF
- **WHEN** the build pass buckets images into date groups
- **THEN** the bucket is derived from the image's EXIF capture date obtained during the decode (not filesystem mtime)

### Requirement: Single-flight builds
The system SHALL ensure that concurrent requests for the same cold or stale album
trigger at most one in-progress build; additional requests SHALL attach to the
in-progress build rather than starting a duplicate.

#### Scenario: Two viewers of a cold album
- **WHEN** two clients request the same uncached album at the same time
- **THEN** exactly one build runs and both clients are served from it

### Requirement: Content-hash invalidation with append-on-add
The system SHALL gate rebuilds on a whole-album content hash (a fast "anything
changed?" check) and, when changed, SHALL rebuild only the sprite sheets whose
per-sheet source hash changed. Newly added images SHALL be appended as new sheets
with stable ordering rather than forcing a full-album rebuild.

#### Scenario: Unchanged album serves cache
- **WHEN** an album is requested and its whole-album hash is unchanged
- **THEN** no rebuild occurs and the cached artifacts are served

#### Scenario: New photos appended cheaply
- **WHEN** images are added to an album
- **THEN** new sprite sheets are appended without rebuilding unchanged existing sheets

#### Scenario: Changed sheet rebuilt selectively
- **WHEN** the album hash changes but only some sheets' source hashes changed
- **THEN** only the affected sheets are rebuilt

### Requirement: Browsing artifacts independent of the enrichment store
The album build cache SHALL be produced and served purely from the image filesystem,
with no dependency on the enrichment database. Album browsing SHALL function when the
enrichment plane is unavailable.

#### Scenario: Enrichment plane down
- **WHEN** the enrichment database is unavailable
- **THEN** the album build pass and serving of cover/sheets/manifest still succeed

