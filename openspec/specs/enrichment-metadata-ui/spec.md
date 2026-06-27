# enrichment-metadata-ui Specification

## Purpose
TBD - created by archiving change harden-enrichment-routing-dev-modes. Update Purpose after archive.
## Requirements
### Requirement: Shared metadata panel in the lightbox
The album, search, and map lightboxes SHALL render image metadata through one
shared component, shown as a footer overlay that appears on view, auto-hides after
a short delay, and can be pinned open via an info toggle. A download button SHALL
be available in the lightbox toolbar.

#### Scenario: Open an enriched image
- **WHEN** a user opens an image that has enrichment data in any of the album, search, or map lightboxes
- **THEN** a panel shows its AI tags, OCR text (if any), place (if any), capture date, and type/size, then fades out unless pinned

#### Scenario: Pin the panel
- **WHEN** the user taps the info toggle
- **THEN** the panel stays visible until toggled off (no auto-hide)

### Requirement: Album enrichment is fail-soft and feature-gated
The album SHALL fetch its images' enrichment only when the runtime feature flag
reports enrichment available, and SHALL swallow any failure. The album's browse,
view, and thumbnail paths SHALL succeed regardless of enrichment availability.

#### Scenario: Enrichment available
- **WHEN** the enrichment feature is reported available and the album loads
- **THEN** the album lightbox panel includes tags/place/OCR for images that have them

#### Scenario: Enrichment unavailable
- **WHEN** the enrichment plane is down (feature reported off, or the fetch fails)
- **THEN** the album still lists, views, and thumbnails images, showing the panel without the enrichment fields

### Requirement: Inline favoriting
Users SHALL toggle an image's favorite state from a control in the album lightbox,
persisted via `PATCH /api/v1/image-data { tags }`. The control SHALL update
optimistically and revert on failure, and the Favorites grouping SHALL update
without a full reload.

#### Scenario: Favorite from the lightbox
- **WHEN** the user toggles the favorite control on the open image
- **THEN** the state flips immediately, is persisted, and the Favorites section reflects the change without a page reload

#### Scenario: Failed favorite write
- **WHEN** the favorite write fails
- **THEN** the control and the Favorites section revert to the prior state

### Requirement: Lightbox keeps position across slide rebuilds
The lightbox index SHALL be controlled (updated as the viewed slide changes) so
that rebuilding the slides array (e.g. after an optimistic favorite update) does
not move the viewer off the current image.

#### Scenario: Favorite without losing place
- **WHEN** the user toggles favorite while viewing a non-first image
- **THEN** the lightbox stays on that image (it does not jump to the first slide)

