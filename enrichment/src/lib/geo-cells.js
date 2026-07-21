// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * H3 geographic cell ids for server-side map density. Each geotagged doc stores
 * its cell id at several resolutions (one facetable field per resolution,
 * `cell_r<res>`), so a single faceted bounding-box query returns the true photo
 * count per cell — no client-side sampling. Cells are derived purely from `_geo`
 * (coordinate math, no file read), so a backfill is cheap (see the geo enricher's
 * version bump).
 *
 * H3 (over raw geohash) because its resolutions step ~7x/level, mapping onto map
 * zoom far more smoothly, and its hexagons avoid square-grid seams. The frontend
 * stays H3-free: this module also converts a cell id to its drawable center /
 * hexagon, so the density endpoint returns geometry, not opaque ids.
 */

const h3 = require("h3-js");
const config = require("./config");

/** Resolutions persisted per doc, coarse→fine (config GEO_CELL_RESOLUTIONS). */
const RESOLUTIONS = config.geoCellResolutions;

/** Facetable field name for a resolution, e.g. 6 -> "cell_r6". */
const fieldName = (res) => `cell_r${res}`;

/** All persisted cell-id field names (for the index's filterable list). */
function cellFieldNames() {
  return RESOLUTIONS.map(fieldName);
}

/** { cell_r1: id, ... } for a coordinate; {} for a non-finite point. */
function cellFields(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  const out = {};
  for (const res of RESOLUTIONS) out[fieldName(res)] = h3.latLngToCell(lat, lng, res);
  return out;
}

/** Center of an H3 cell as { lat, lng }. */
function cellCenter(cellId) {
  const [lat, lng] = h3.cellToLatLng(cellId);
  return { lat, lng };
}

/** Hexagon boundary as [[lat, lng], ...] (6 vertices; Leaflet closes the ring). */
function cellHexagon(cellId) {
  return h3.cellToBoundary(cellId);
}

module.exports = { RESOLUTIONS, fieldName, cellFieldNames, cellFields, cellCenter, cellHexagon };
