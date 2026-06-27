# map-ui

A browsable map surface where geotagged photos are laid out and discoverable. The
viewport is the query. Additive and fail-soft.

## ADDED Requirements

### Requirement: Map rendering with self-hostable tiles
The frontend SHALL render geotagged photos on a Leaflet map using OpenStreetMap
tiles, with no mandatory third-party tile dependency.

#### Scenario: Open the map
- **WHEN** a user opens the map surface
- **THEN** geotagged photos are displayed on a Leaflet map over OSM tiles

### Requirement: Zoom-aware clustering
The map SHALL cluster markers by zoom level using `supercluster`, expand clusters
on zoom-in, and use existing sharp-generated thumbnails as marker imagery.

#### Scenario: Many photos in one area
- **WHEN** many photos fall within a small area at the current zoom
- **THEN** they render as a single cluster showing a count, which expands as the user zooms in

### Requirement: Viewport-as-query
The map SHALL translate the current bounding box into a `_geoBoundingBox` query
and re-query/re-cluster on pan and zoom.

#### Scenario: Pan the map
- **WHEN** the user pans or zooms the map
- **THEN** the visible photos update to those whose coordinates fall within the new viewport

### Requirement: Combined map and search filters
The map SHALL combine the viewport with the text/semantic search box and a
`taken_at` date filter in a single query.

#### Scenario: Search within a region
- **WHEN** the user enters a query and a date range while a map area is shown
- **THEN** results are filtered by viewport, text/semantic relevance, and date together

### Requirement: Manual location assignment
The map SHALL allow assigning a location to a photo by placing or dragging a pin,
persisted as `_geo` with `geo_source: manual`.

#### Scenario: Place a pin
- **WHEN** the user drops a pin for a photo without GPS
- **THEN** the photo's `_geo` is saved with `geo_source: manual` and it appears on the map

### Requirement: Map fails soft
When MeiliSearch is unreachable, the map surface SHALL degrade gracefully and
SHALL NOT block gallery browsing.

#### Scenario: Search backend down
- **WHEN** the map cannot reach MeiliSearch
- **THEN** the map shows an unavailable state and the rest of the gallery remains usable
