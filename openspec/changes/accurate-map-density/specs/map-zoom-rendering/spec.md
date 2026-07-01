## ADDED Requirements

### Requirement: Zoom-dependent representation

The map SHALL choose its representation by zoom, driven from server density data,
using two configurable thresholds: hexbins when far out, group circles at mid
zoom, and individual photo thumbnails when zoomed in. The thresholds and the
zoom→resolution ladder SHALL be configurable values, not hard-coded magic numbers.

#### Scenario: Far zoom

- **WHEN** the map is zoomed at or below the far/mid threshold
- **THEN** the map SHALL render H3 hexbins colored by per-cell count

#### Scenario: Mid zoom

- **WHEN** the map is zoomed between the two thresholds
- **THEN** the map SHALL render group circles labelled with each cell's true count

#### Scenario: Near zoom

- **WHEN** the map is zoomed above the mid/near threshold
- **THEN** the map SHALL render individual photo thumbnails for sparse photos
- **AND** any remaining dense location SHALL render as a single circle with its
  true count

#### Scenario: Thresholds are tunable

- **WHEN** the configured thresholds or zoom→resolution ladder are changed
- **THEN** the zoom bands at which each representation applies SHALL change
  accordingly, with no code change beyond the configuration

### Requirement: Sparse locations remain discoverable at far zoom

At far zoom the rendering SHALL make every populated location visible regardless of
how dense the busiest location is, so a sparse outlier is obvious and can be zoomed
into. Density SHALL be conveyed by a color scale that does not let the busiest cell
render sparse cells invisible.

#### Scenario: A lone photo beside a huge pile

- **WHEN** the world view contains one location with ~18,732 photos and another
  with a single photo
- **THEN** the single-photo cell SHALL render as a solid, visibly-colored hexagon
  (not faded to invisible)
- **AND** the dense cell SHALL render in a distinctly hotter color

### Requirement: Per-zoom click semantics

Click behavior SHALL match what is meaningful at the current zoom: zoom-in at far
zoom, open a scrollable photo list at mid zoom, open the lightbox at near zoom.

#### Scenario: Clicking a hexbin at far zoom

- **WHEN** the user clicks a hexbin while zoomed out
- **THEN** the map SHALL zoom into that cell (it SHALL NOT attempt to open a photo
  list of an unreasonably large set)

#### Scenario: Clicking a circle at mid zoom

- **WHEN** the user clicks a group circle
- **THEN** a scrollable, paged photo list for that cell SHALL open

#### Scenario: Clicking a thumbnail at near zoom

- **WHEN** the user clicks an individual photo thumbnail
- **THEN** the lightbox SHALL open on that photo

### Requirement: Dense locations are fully browsable

A dense location's photo list SHALL be browsable in full via paging, not limited to
a sampled subset.

#### Scenario: Paging through a pile

- **WHEN** the user opens the photo list for a location with thousands of photos
  and scrolls
- **THEN** the list SHALL page in additional photos on demand until the location is
  exhausted
- **AND** the list header SHALL show the location's true total

### Requirement: Map deep-links resolve reliably

A "View on map" deep-link to a specific photo SHALL focus the map on that photo's
location and make the photo reachable, regardless of how many photos share that
location.

#### Scenario: Deep-link to a photo in a dense location

- **WHEN** a "View on map" link targets a photo at a location holding far more than
  the old sample cap
- **THEN** the map SHALL center on that location and surface it (count/list),
  with the target photo reachable
- **AND** the action SHALL NOT silently no-op as it did under sampled clustering
