# album-build-cache Specification (delta)

## MODIFIED Requirements

### Requirement: Per-album build pass produces cached artifacts
The system SHALL provide a per-album build pass that walks the album's media
files (every registry-supported image and video format, via the shared
media-discovery walker), decodes each source once through its correct pipeline
(sharp for images, ffmpeg frame extraction for videos), and writes to a
persistent FS cache: a collage cover image, one or more date-grouped sprite
sheets, and a manifest. A supported media file SHALL never be silently dropped
because of media-type misdispatch; a file skipped because the running build
cannot decode its format SHALL be skipped with a logged reason. Artifacts
SHALL be written atomically (write to a temp path, then rename) so a partially
written artifact is never served.

#### Scenario: Cold album build
- **WHEN** the build pass runs for an album with no cached artifacts
- **THEN** it writes `cover`, `sprites/<group>-<n>`, and `manifest.json` under that album's cache directory

#### Scenario: Atomic artifact writes
- **WHEN** an artifact is being written
- **THEN** readers either see the previous complete artifact or the new complete artifact, never a partial file

#### Scenario: Every supported video format gets a cell
- **WHEN** an album containing `.mov`, `.mp4`, `.m4v`, and `.webm` files is built
- **THEN** each video renders a sprite cell via ffmpeg (previously `.m4v`/`.webm` were dispatched to sharp, failed, and were silently skipped)

#### Scenario: Undecodable format is skipped visibly
- **WHEN** the build encounters a registry image format the running sharp build cannot decode (e.g. `.bmp`, or `.heic` without HEIF support)
- **THEN** the file is skipped with a logged reason rather than silently, and the rest of the build completes
