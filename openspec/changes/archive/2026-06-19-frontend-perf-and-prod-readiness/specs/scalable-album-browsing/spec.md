## ADDED Requirements

### Requirement: Album view renders from the sprite manifest
The album page SHALL render its grid from the album manifest and sprite sheets rather
than fetching full per-file metadata for every image up front. It SHALL display a
fixed square-cell grid, with each cell drawn as a crop of its sprite sheet.

#### Scenario: Album renders from sprites
- **WHEN** a user opens an album whose cache is ready
- **THEN** the grid is rendered from the manifest and sprite sheets without a full per-file metadata fetch

#### Scenario: Album still building
- **WHEN** a user opens a cold album
- **THEN** the page shows build progress and renders sprite sheets as they become ready

### Requirement: Pinch-zoom changes column count at one sheet resolution
Sprite cells SHALL be baked at the largest intended display size and CSS-scaled down
for denser layouts. Pinch-zoom (or an equivalent control) SHALL change the column
count and CSS scale only, without fetching a different sheet resolution.

#### Scenario: Zooming the grid
- **WHEN** a user pinch-zooms the album grid
- **THEN** the column count and cell display size change while the same sprite sheets are reused

### Requirement: Lightbox shows full-size, aspect-correct, with enrichment overlay
Selecting a cell SHALL open the lightbox at the corresponding full-size image,
displayed aspect-correct (not square-cropped), and SHALL preserve the existing
enrichment-metadata overlay and the inline favorite toggle.

#### Scenario: Open an image from the grid
- **WHEN** a user selects a grid cell
- **THEN** the lightbox opens at that image full-size and aspect-correct

#### Scenario: Enrichment overlay preserved
- **WHEN** the enrichment plane is available and the opened image has enrichment data
- **THEN** the lightbox shows the enrichment-metadata overlay as it does today

### Requirement: Home album covers are cached collages of all images
On the home page, each album's preview SHALL be a single cached collage cover
representing all of the album's images, fetched as one request per album, replacing
the prior per-album distributed thumbnail sample.

#### Scenario: Home shows album covers
- **WHEN** a user opens the home page
- **THEN** each album shows its single cached collage cover, one request per album
