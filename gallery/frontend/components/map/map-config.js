// vim: tabstop=2 shiftwidth=2 expandtab
//
// Tunable dials for the map's zoom-dependent rendering, kept in one place so the
// splits can be A/B'd without hunting through MapView. Representation follows
// intent, which changes with zoom:
//
//   zoom 0 ─── HEAT_MAX_ZOOM ─── CIRCLE_MAX_ZOOM ─── 19
//        │ hexbins │  circles      │  thumbnails      │
//        │ (heat)  │  (counts)     │  (real docs)     │
//
// Counts always come from the server's H3 density (true totals), never a sample.

// Zoom at/below which we paint H3 hexbins (density, click = zoom in).
export const HEAT_MAX_ZOOM = 5;
// Zoom at/below which (and above HEAT_MAX_ZOOM) we draw count circles
// (click = open the cell's paged photo list). Above this we render real
// thumbnails.
export const CIRCLE_MAX_ZOOM = 12;
// Where a "View on map" deep-link lands: circle mode, so the target's cell shows
// its true count and its paged list is one click (or auto-open) away.
export const DEEP_LINK_ZOOM = CIRCLE_MAX_ZOOM;

// A near-zoom cell with more than this many photos is too dense to show as loose
// thumbnails, so it renders as a single count circle instead.
export const CELL_THUMB_LIMIT = 60;
// Page size for a cell's photo list and the near-zoom sparse fetch.
export const POPUP_PAGE_SIZE = 60;
export const NEAR_SPARSE_LIMIT = 500;

// Zoom → H3 resolution ladder. Must stay within the resolutions the enricher
// persists (config GEO_CELL_RESOLUTIONS, default 1..8). Coarse when far out,
// finer as you zoom in. Empirical — tune alongside the thresholds above.
const RES_LADDER = [
  { maxZoom: 2, res: 1 },
  { maxZoom: 4, res: 2 },
  { maxZoom: 5, res: 3 },
  { maxZoom: 7, res: 4 },
  { maxZoom: 9, res: 5 },
  { maxZoom: 11, res: 6 },
  { maxZoom: 12, res: 7 },
  // Near zoom (thumbnail mode) keeps refining to FINE cells so a dense pile's
  // bubble sits on-screen (a ~25 m res-11 cell center is basically on the photos)
  // and a loner lands in its own cell instead of lumping into a neighbour's pile.
  // The density facet still gives the true count per cell, uncapped.
  { maxZoom: 13, res: 8 },
  { maxZoom: 15, res: 9 },
  { maxZoom: 17, res: 10 },
  { maxZoom: Infinity, res: 11 },
];

export function resolutionForZoom(zoom) {
  for (const step of RES_LADDER) if (zoom <= step.maxZoom) return step.res;
  return RES_LADDER[RES_LADDER.length - 1].res;
}

export function modeForZoom(zoom) {
  if (zoom <= HEAT_MAX_ZOOM) return 'hexbin';
  if (zoom <= CIRCLE_MAX_ZOOM) return 'circle';
  return 'thumbnail';
}

// Fixed log-ish buckets so a region's color is stable across pans and EVERY
// populated cell is a solid, visible color — a lone photo beside an 18k pile must
// not fade to invisible. Ordered low→high; last bucket is the catch-all.
export const COUNT_BUCKETS = [
  { max: 1, color: '#c6dbef', label: '1' },
  { max: 9, color: '#7fb0d8', label: '2–9' },
  { max: 99, color: '#4a90c2', label: '10–99' },
  { max: 999, color: '#f0883b', label: '100–999' },
  { max: Infinity, color: '#d7301f', label: '1000+' },
];

export function bucketColor(count) {
  for (const b of COUNT_BUCKETS) if (count <= b.max) return b.color;
  return COUNT_BUCKETS[COUNT_BUCKETS.length - 1].color;
}

// Leaflet bounds [[minLat,minLng],[maxLat,maxLng]] enclosing a hexagon ring
// ([[lat,lng],...]) — used to zoom-to-fit a clicked hexbin.
export function ringBounds(ring) {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const [lat, lng] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return [[minLat, minLng], [maxLat, maxLng]];
}

// Ray-cast point-in-polygon over a [[lat,lng],...] ring. Used to find which cell
// a deep-linked coordinate falls in (the frontend has no H3 lib by design).
export function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    const intersect =
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;
    if (intersect) inside = !inside;
  }
  return inside;
}
