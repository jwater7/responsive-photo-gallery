## ADDED Requirements

### Requirement: Geographic cell ids on geotagged documents

Each geotagged document SHALL carry a hierarchical geographic cell id (H3) at
multiple resolutions, derived from its existing `_geo` coordinates. The cell-id
fields SHALL be computed without re-reading the source media file (coordinate math
only).

#### Scenario: A geotagged photo is enriched

- **WHEN** the geo enricher processes a document that has a valid `_geo`
- **THEN** the document SHALL be assigned an H3 cell id for each configured
  resolution (e.g. r1 through r8)
- **AND** a document with no `_geo` SHALL receive no cell-id fields

#### Scenario: Existing documents are backfilled

- **WHEN** the one-time backfill (force-geo re-enrich) runs over the existing index
- **THEN** every already-geotagged document SHALL gain its cell-id fields
- **AND** the backfill SHALL NOT read media files (it derives ids from stored
  `_geo`)

### Requirement: Per-cell counts are queryable via faceting

The search index SHALL expose the cell-id fields as filterable, faceted attributes
so that a single bounding-box query returns the true photo count per cell. The
facet limit SHALL be configured high enough that all cells visible in a viewport
are returned (not truncated).

#### Scenario: Faceted count query over a viewport

- **WHEN** a search is issued with a `_geoBoundingBox` filter and a facet on the
  cell-id field for a chosen resolution
- **THEN** the response SHALL include, per non-empty cell in the box, the exact
  count of matching documents
- **AND** the counts SHALL reflect all matching documents, never a capped sample

#### Scenario: Counts stay live

- **WHEN** new geotagged documents are indexed after an earlier query
- **THEN** a subsequent density query SHALL include them with no index rebuild or
  cache-warm step (counts come from the live index)

### Requirement: Viewport density endpoint

The enrichment API SHALL provide an endpoint that, given a bounding box and a
target resolution (or zoom), returns the populated cells with their true counts
and drawable geometry, plus an exact viewport total. It SHALL honor the same
inferred-pin exclusion as search.

#### Scenario: Density requested for a viewport

- **WHEN** a client requests density for a bounding box at a given resolution
- **THEN** the response SHALL list each non-empty cell with its count and its
  center and/or hexagon geometry (already converted server-side)
- **AND** the response SHALL include an exact whole-viewport total

#### Scenario: Inferred pins excluded

- **WHEN** a density request sets the exclude-inferred flag
- **THEN** caption-inferred (`geo_source: "inferred"`) documents SHALL NOT be
  counted in any cell or in the viewport total

#### Scenario: Dense location reports the truth

- **WHEN** density is requested over a location holding far more than the old
  500-doc sample cap (e.g. ~18,732 colocated photos)
- **THEN** that cell's reported count SHALL be the true total, not a capped or
  sampled number
