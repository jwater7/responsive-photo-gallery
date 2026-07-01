## Why

The map decides what to draw from a **sampled** fetch — up to 500 docs per
viewport, clustered client-side. With ~81.5k geotagged photos (and single
locations holding ~18.7k), every count and every "lone pin vs. pile" decision is
made from an incomplete, geographically-unrepresentative sample. The result is
wrong: at world zoom whole regions of photos are invisible (the 500 happen to
fall elsewhere), dense locations under-count or vanish, and a "View on map"
deep-link to a photo in a dense spot silently fails to open because the target
isn't among the sampled 500. The map cannot tell the truth about where photos
are, which is its entire job.

## What Changes

- **BREAKING (map data path):** Replace the client-side clustering of a 500-doc
  sample with **server-computed density**. The server returns true counts for the
  viewport (never a sample), so positions and counts reflect all photos.
- Add a precomputed **H3 cell id** (a few resolutions) to each geotagged doc,
  derived from existing `_geo` — no file re-read. Enable Meili **faceting** so one
  query returns the true photo count per cell in view, always fresh.
- New **viewport-density endpoint** on the enrichment API: given a bounding box
  and zoom, returns per-cell `{ center/hexagon, count }` (and a viewport total),
  honoring the existing `excludeInferred` filter.
- **Zoom-dependent rendering** with two configurable thresholds:
  - **far** (world → country): **H3 hexbins**, log-bucketed so every populated
    cell is a solid, visible color — sparse outliers stay obvious and are
    zoom-into-able; click zooms in (no meaningless "open 18k photos").
  - **mid** (region → city): **group circles** with true counts; click opens the
    paged photo list.
  - **near** (neighborhood → street): **individual photo thumbnails** (a bounded
    real-doc fetch, with dense piles excluded by cell id so they never blow the
    budget), plus a circle for any remaining pile; click opens the lightbox.
- Dense locations are fully browsable via a **paged photo list** (offset paging by
  the cell's bbox), fixing both the unbrowsable-pile and the dead "View on map"
  deep-link.
- Retire the `limit: 500` viewport sample and the client-side Supercluster
  density decision.

## Capabilities

### New Capabilities
- `map-density-aggregation`: server-side, always-fresh true photo counts per
  geographic cell for a viewport — the H3 cell-id field, Meili faceting config,
  and the density endpoint. Replaces sampled, client-side density.
- `map-zoom-rendering`: the zoom-driven representation ladder (hexbins → circles
  → thumbnails) with discoverability of sparse cells, per-zoom click semantics,
  configurable zoom thresholds, and the zoom→H3-resolution ladder.

### Modified Capabilities
<!-- None: the map/search feature has no existing OpenSpec spec; these are new. -->

## Impact

- **Enrichment service** (`enrichment/`): geo enricher computes + stores H3 cell
  ids (`enrichers/geo.js`); a one-time backfill of existing geotagged docs
  (derived from `_geo`, via the force-geo re-enrich path); Meili settings gain the
  cell-id fields as filterable + faceting config (`lib/meili.js`); a new
  `multiSearch`/facet wrapper and the density route (`routes/enrichment-api.js`).
  New dependency: `h3-js`.
- **Gallery frontend** (`gallery/frontend/`): map view rewritten to render from
  density + the zoom ladder (`components/map/MapView.js`), a density API client
  (`lib/enrich-api.js`), configurable thresholds + resolution ladder.
- **Meili index**: new filterable/faceted string fields; `faceting.maxValuesPerFacet`
  raised. No experimental flags (faceting is core; `_geoBoundingBox` already used).
- **Deploy**: both images rebuilt (`responsive-photo-enrichment-indexer`,
  `responsive-photo-gallery`); backfill run once after the enrichment image ships.
- Supersedes the in-flight map fixes: the unrelated ffprobe fix (`384c711`) stays;
  the album Back-restore fix (`2e1b6ce`) stays; the static-export map.js change
  (`8827732`) is superseded/reverted here.
