# geo-enrichment

Find images by where they were taken — as place-name text and as coordinates for
the map. All geocoding is offline; location is optional.

## ADDED Requirements

### Requirement: Local EXIF extraction
The geo enricher SHALL extract GPS coordinates and `taken_at` (EXIF
DateTimeOriginal) using a local library (`exifr`), treating absent location as a
normal condition rather than an error.

#### Scenario: Image with GPS
- **WHEN** the geo enricher processes an image whose EXIF contains GPS
- **THEN** it writes `_geo { lat, lng }` and `taken_at` to the document

#### Scenario: Image without GPS
- **WHEN** an image has no GPS metadata
- **THEN** no `_geo` field is written and the file is still enriched on other axes

### Requirement: Offline reverse geocoding
The geo enricher SHALL reverse-geocode coordinates to a place hierarchy
(city/region/country) using a bundled offline dataset (GeoNames), with no
outbound network calls, and store the place hierarchy as searchable text.

#### Scenario: Coordinates to place text
- **WHEN** a document has `_geo` coordinates
- **THEN** the enricher writes searchable place text (e.g. city/region/country) derived offline

### Requirement: Native geo indexing
The `docs` index SHALL store coordinates in MeiliSearch's native `_geo` field and
support geo bounding-box / radius filters and sort-by-distance, combinable with
keyword, vector, and `taken_at` filters in one query.

#### Scenario: Geo bounding-box query
- **WHEN** a query includes a `_geoBoundingBox`
- **THEN** only documents whose coordinates fall inside the box are returned, and may be combined with a text/semantic query

### Requirement: Location source precedence
The enricher SHALL record `geo_source` ∈ { `manual`, `exif`, `inferred` } with
precedence manual > exif > inferred, and SHALL NOT overwrite a manual location on
re-scan.

#### Scenario: Re-scan over a manual pin
- **WHEN** a reconcile scan processes a file whose location was set manually
- **THEN** the EXIF enricher leaves the manual `_geo` and `geo_source` unchanged
