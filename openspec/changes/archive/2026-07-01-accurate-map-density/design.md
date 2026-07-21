## Context

The map (`gallery/frontend/components/map/MapView.js`) fetches up to 500 docs for
the current bounding box (`ViewportSearch`, `MapView.js:101`) and clusters them
client-side with Supercluster. The 500 cap makes every density decision a guess
from an unrepresentative sample. Confirmed failures: a bbox query at one home
location returns **18,732** photos but the map only ever sees 500; a `geo_source:
"exif"` deep-link (`hash d4a4…`) never opens its popup because the target isn't in
the 500; at world zoom the 500 are returned in Meili's default order (no
geo-representative sampling), so whole regions render as nothing.

Confirmed primitives (Explore pass):
- No faceting and no geohash/cell field today; docs carry only raw `_geo {lat,lng}`
  (`meili.js:42-51`, `geo.js`).
- `/search` already returns true `estimatedTotalHits` per `_geoBoundingBox`
  (`enrichment-api.js:128`); the map ignores it.
- `meilisearch` client (v0.58) supports multi-search; `meili.js` already has
  `getDoc(hash)` (line 103) and a pass-through `search()` (line 176).
- Meili server v1.47; faceting is core (no experimental flag); `_geoBoundingBox`
  in use.

Constraints: prod box is a weak FX-6300 (no HW transcode, swap-heavy); pan must
feel ~as responsive as today; phones are a target (avoid large client payloads);
scans are periodic (24h reconcile + manual), not continuous.

## Goals / Non-Goals

**Goals:**
- True, non-sampled photo counts everywhere on the map (world → street).
- Sparse outliers stay **obvious and zoom-into-able** at world view.
- Keep today's loved behaviors: individual thumbnails when sparse, clickable
  group circles that open a scrollable photo list when dense.
- Dense locations fully browsable (paged), and "View on map" deep-links land
  reliably.
- Pan performance ≈ today; small per-pan payloads.

**Non-Goals:**
- Real-time map freshness (new photos appearing on the map only after they're
  indexed is fine — counts come live from Meili, so this is essentially free).
- Server-side photo *clustering* with organic centroids (the C3 in-memory
  Supercluster alternative — see Decisions).
- Continuous smooth heatmaps (rejected; see Decisions).
- Paging *inside* the lightbox (a later refinement; the popup pages, the lightbox
  opens the loaded set).

## Decisions

### D1 — Server returns true per-cell density; client never clusters a sample
The root cause is sampling on the client. Move the density decision to the server,
which can count all matching docs cheaply. This is the non-negotiable core; the
rest is *how* the server counts.

### D2 — Cell counts via a precomputed H3 id + Meili faceting (not in-memory clustering)
Two viable shapes were compared:
- **C3 — server-side Supercluster over an in-memory index of all `_geo`.** Pros:
  organic clusters, smooth per-zoom resizing, zero data migration. Cons: the
  enrichment service must hold and **rebuild a ~13 MB spatial index** after every
  scan (stateful; a staleness window).
- **H3 cell id + faceting (chosen).** Each doc stores an H3 cell id at a few
  resolutions; one faceted, bbox-filtered query returns the exact count per cell.
  Pros: **stateless and always-fresh** (counts come straight from the live index —
  this is exactly C3's one weakness, eliminated), one cheap query/pan, scales.
  Cons: a one-time backfill + faceting config; cells snap to a grid.

Chosen H3 because the freshness/statelessness fit the periodic-scan, weak-box
reality, and — critically — the zoom-rendering ladder (D4) neutralizes H3's only
real downside (grid look). **H3 over raw geohash**: H3 resolutions step ~7×/level
vs geohash ~32×/char, so they map onto map zoom far more smoothly (less "re-grid"
jumping), and hexagons avoid square-grid seams.

Cross-stack support (verified feasible): h3-js is Uber's official Node lib
(`latLngToCell`, `cellToLatLng`, `cellToBoundary`); Meili treats the cell id as an
opaque facetable string (no H3 awareness needed); the frontend needs **no** H3 lib
because the server returns each cell's center/hexagon geometry already converted.

### D3 — Multi-resolution cell ids, indexed by a zoom→resolution ladder
Store H3 ids at a handful of resolutions (e.g. r1…r8) as separate facetable string
fields. The map picks the resolution for the current zoom from a tunable ladder
and facets on that field. Storing a few resolutions (not all 16) keeps index
growth modest; the ladder is config because "which resolution reads well at which
zoom" is empirical.

### D4 — Zoom-dependent rendering with two configurable thresholds
Representation follows intent, which changes with zoom. The **same** server
density data feeds all three faces; only the frontend rendering switches:
- **far (world→country):** H3 **hexbins**, log-bucketed color. Click = zoom in.
- **mid (region→city):** group **circles** with true counts. Click = paged list.
- **near (neighborhood→street):** individual **thumbnails** (bounded real-doc
  fetch) + a circle for any remaining pile. Click = lightbox.

The two thresholds (`HEAT_MAX_ZOOM`, `CIRCLE_MAX_ZOOM`) and the zoom→resolution
ladder are **named, configurable** values (the user will A/B them); educated-guess
defaults ~zoom 5 and ~zoom 12.

### D5 — Hexbins (not smooth heat) so sparse outliers stay visible
A normalized smooth heatmap scales intensity against the max, so an 18,732 pile
drives a lone photo's intensity to ~0 — the exact outlier you want to notice
disappears. Hexbins with a **fixed log-bucket** color scale paint *every* populated
cell as a solid, distinct color (lowest bucket still opaque), so a single-photo
cell is unmistakable and zoom-into-able. Bonus: a hexagon is a natural click→zoom
target (meaningful at far zoom, unlike "open 18k"), and it needs no heat library —
just react-leaflet `<Polygon>`s. Fixed buckets (not per-viewport quantiles) keep a
region's color stable across pans.

### D6 — Near-zoom thumbnails via a cell-excluded bounded fetch
To keep the beloved "sparse → thumbnails" UX without re-introducing the 500 trap:
fetch real docs for the viewport but **exclude the dense cells by id** (`cell_rN
NOT IN [dense cells]`). The pile is removed by label, so the remaining sparse docs
comfortably fit a bounded limit; feed them to the existing client Supercluster for
organic thumbnails/local grouping. Dense cells render as a circle with their true
facet count.

### D7 — Browse a pile + deep-link via paged photo list
Clicking a circle (or a deep-link landing on a cell) opens a fixed-size popup
whose internal scroll area pages photos for that cell's bbox via
`geoSearch({ geoBoundingBox, offset, limit, excludeInferred })`, reusing the
infinite-scroll pattern from `search.js:176-190`. This fixes the unbrowsable pile
and the dead "View on map" deep-link without any sample dependency.

### D8 — Backfill by bumping the geo enricher version
H3 ids derive purely from `_geo` (no file read). The backfill mechanism is a
**version bump** on the geo enricher (2 → 3): `isCurrent` then treats every
existing geo doc as stale, so geo re-runs and writes the H3 fields on the next
**full** scan (version regen does not trigger on the stat-gated delta). Admin
Force (stage geo) is the on-demand equivalent. The bump is mandatory, not
optional — skipping it is exactly how the IM→sharp OCR migration left old docs on
stale OCR until someone forced them.

### D9 — Fine resolutions at near zoom (revised during implementation)
Verification exposed that a single fixed cell size fails at max zoom: a res-8
cell (~461 m) is wider than a zoom-19 viewport, so its center falls off-screen
("the pile disappears") and a loner ~460 m from a pile shares the cell and lumps
into it. **Client Supercluster on the near-zoom fetch was tried and rejected** —
the fetch is capped at 500, so it undercounts a >500 pile (shows "500", not the
true count) and can miss coverage. The fix is to keep the server-density model but
**persist finer resolutions (r1→r11)** and map high zoom to fine cells. Then the
facet still gives the true, uncapped count even for a 10k+ pile; a nearby loner
lands in its own fine cell (separates); and a ~25 m cell's center is on-screen.
Verified: a 1000-pile + close outliers → the pile cell reports 999 (not 500) and
the outliers are distinct cells. Deep-links also now honor the URL `z`.

## Risks / Trade-offs

- **Grid artifacts at mid zoom (circles snap to cells)** → The zoom ladder (D4)
  confines gridded circles to a thin mid band, sandwiched by hexbins (far) and
  real thumbnails (near). Over near-point-like piles the snap is invisible. H3
  hexagons (vs squares) further reduce seam artifacts.
- **Backfill / migration effort** → One-time, derived from `_geo`, no disk I/O,
  reuses the shipped force-geo path; reversible (drop the fields + faceting).
- **`faceting.maxValuesPerFacet` default 100 could truncate cells in view** →
  Raise it (e.g. 1000) and pick resolutions so visible cell count stays bounded by
  viewport/cell-size.
- **Cell-boundary double counting (inclusive bbox) / split groups** → Use the
  single whole-viewport `estimatedTotalHits` for the honest header; boundary
  splits only matter at mid zoom and Supercluster reunifies sparse docs across
  cells at near zoom.
- **Per-pan query cost on the weak box** → One faceted count query (far/mid) and,
  near zoom, one bounded doc query; both cheaper than today's 500-doc transfer.
  Far zoom (heaviest data) needs only counts — the cheapest case.
- **h3-js dependency** → Server-only; well-maintained official lib; frontend stays
  H3-free (server returns geometry).

## Migration Plan

1. Ship enrichment: geo enricher computes H3 ids; Meili settings add cell-id
   fields (filterable + faceting, raised `maxValuesPerFacet`); density endpoint
   live. GOTCHA: the indexer and worker are **separate images** — rebuild BOTH,
   or the worker keeps running old enricher code (hit locally: cells stayed at
   res 8 / geo v3 until the worker image was rebuilt too).
2. Backfill: with the geo `version` bumped (D8), trigger a **full** scan (or admin
   Force, stage geo) so existing geo docs regenerate with H3 ids; verify cell
   counts via a multi-search / facet sanity query (dense home cell ≈ 18,732; sum ≈
   whole-viewport total).
3. Ship gallery image: map renders from density + the zoom ladder.
4. Rollback: revert images; drop the cell-id fields + faceting config. The raw
   `_geo` data path is untouched, so the old sampled map still functions if needed.

Note on `8827732`: the proposal listed it for revert, but implementation showed
the new deep-link centering needs a reliably-parsed `initial`, which `8827732`'s
`window.location.search` parse provides on a static-export hard load. It is
therefore KEPT, not reverted (reverting would reintroduce the router.query race).

## Open Questions

- Exact zoom→resolution ladder and the two thresholds — ship educated-guess
  defaults, tune live (they're config).
- Which H3 resolutions to persist (index-size vs ladder smoothness).
- Hexbin click at far zoom: zoom-to-fit the cell vs. a fixed zoom step.
- Should the mid-zoom circle also show a representative thumbnail backdrop (one
  sample doc per cell), or stay a plain count bubble?
