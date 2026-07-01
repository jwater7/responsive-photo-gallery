## 1. Backend — cell ids + faceting (enrichment)

- [x] 1.1 Add `h3-js` to `enrichment/package.json`
- [x] 1.2 In `enrichers/geo.js`, compute H3 cell ids from `_geo` at the configured
      resolutions (e.g. r1…r8) and write them as fields; emit nothing when `_geo`
      is absent
- [x] 1.3 Make the persisted resolution set a named config value (not hard-coded)
- [x] 1.4 In `lib/meili.js`, add the cell-id fields to `filterableAttributes` and
      add `faceting.maxValuesPerFacet` (raised, e.g. 1000) to `updateSettings`
- [x] 1.5 **Bump the geo enricher `version`** (currently 2 → 3) — REQUIRED so a
      full rescan regenerates H3 on existing docs. A version mismatch makes
      `isCurrent` stale → geo re-runs. Without the bump, existing docs keep
      *no* H3 ids until explicitly forced (the exact trap the IM→sharp OCR
      migration hit by not bumping `ocr.version`). Note: version regen triggers on
      a **full** scan (re-hash), not the stat-gated delta — backfill = full scan
      or admin Force (stage geo)

## 2. Backend — density endpoint (enrichment)

- [x] 2.1 Add a `multiSearch`/facet helper to `lib/meili.js` (wrap
      `client.multiSearch` and/or a faceted `search`)
- [x] 2.2 Add `POST /geo-density` to `routes/enrichment-api.js`: input bbox +
      resolution (or zoom) + optional query + `excludeInferred`; facet on the
      resolution's cell-id field within the bbox
- [x] 2.3 Convert each returned cell id to center + hexagon geometry server-side
      (h3-js `cellToLatLng` / `cellToBoundary`); return `[{ cell, center, hexagon,
      count }]`
- [x] 2.4 Include an exact whole-viewport total (one `estimatedTotalHits` for the
      bbox) in the response
- [x] 2.5 Reuse `/search`'s filter-building and `excludeInferred` handling
      (`enrichment-api.js:46-137`); do not cap counts to a sample
- [x] 2.6 Add a node:test for `/geo-density`: seeded bbox counts are exact and
      respect `excludeInferred`

## 3. Backend — backfill + verify (enrichment)

- [x] 3.1 LOCAL: rebuilt both enrichment images (indexer AND worker — separate
      images!) and ran a full scan → geo v4 backfilled H3 cells (incl. fine r9–11).
- [x] 3.2 Facet sanity verified: a 1000-image pile + 6 close outliers →
      `/geo-density` reports the pile cell at **count 999 (uncapped, not 500)** and
      the 6 outliers in their own cells. Confirms >500 piles count correctly.

## 4. Frontend — density client + config (gallery)

- [x] 4.1 Add `geoDensity(body)` to `lib/enrich-api.js` (mirror `geoSearch`, POST
      `/geo-density`)
- [x] 4.2 Add map rendering config: `HEAT_MAX_ZOOM`, `CIRCLE_MAX_ZOOM`, and the
      zoom→H3-resolution ladder — named, easily-edited values with educated-guess
      defaults (~5 and ~12)
- [x] 4.3 Add `/geo-density` to the gallery proxy allowlist
      (`gallery/routes/enrich.js` — it's an explicit allowlist, not a wildcard;
      omitting it 404s the frontend call and blanks the map)

## 5. Frontend — zoom-rendering ladder (gallery)

- [x] 5.1 In `MapView.js`, fetch density on `moveend` (keep the 300ms debounce) at
      the resolution chosen from the current zoom
- [x] 5.2 Far zoom: render H3 hexbins as react-leaflet `<Polygon>`s, colored by a
      fixed log-bucket scale where every populated cell is opaque/visible; click =
      zoom into the cell
- [x] 5.3 Mid zoom: render group circles labelled with each cell's true count;
      click = open the paged photo list (Stage 6)
- [x] 5.4 Near zoom: fetch sparse real docs via `geoSearch` with the dense cells
      excluded by cell id (`cell_rN NOT IN [...]`) → individual thumbnails; a dense
      cell renders as a bubble at its (fine) cell center. NOTE: client Supercluster
      was tried and rejected — on the 500-cap fetch it undercounts a >500 pile.
      The fix is FINER cells at near zoom (see 5.7), so the facet count stays true
      (uncapped) and a nearby loner lands in its own cell instead of lumping.
- [x] 5.5 Show the true whole-viewport total in the map header
- [x] 5.6 Remove the dead sampled path (`ViewportSearch` `limit: 500`,
      client-side-clustering-as-density)
- [x] 5.7 Fine-resolution rework (discovered in verify): persist H3 res 1→11 and
      map high zoom to fine cells (`config.geoCellResolutions`, geo version 3→4,
      the zoom→res ladder). Fixes the max-zoom "bubble off-screen / loner lumps"
      class while keeping true uncapped counts. Also honor the URL `z` for
      deep-links. Re-backfill via a full scan.

## 6. Frontend — paged pile popup + deep-link (gallery)

- [x] 6.1 Build the fixed-size, internally-paged popup: scroll loads more via
      `geoSearch({ geoBoundingBox: cellBbox, offset, limit, excludeInferred })`,
      reusing the IntersectionObserver pattern from `search.js:176-190`; header
      shows the cell's true total
- [x] 6.2 Open the popup from a clicked mid-zoom circle (and from a near-zoom pile
      circle)
- [x] 6.3 "View on map" deep-link: center/zoom on the target's `_geo`, surface its
      cell, and make the target reachable (no silent no-op); keep the
      `excludeInferred` deep-link seed from `2e1b6ce`

## 7. Housekeeping + deploy

- [x] 7.1 KEEP `8827732` (do NOT revert). Implementation revealed the new
      deep-link centering depends on a reliably-parsed `initial`; `8827732`'s
      `window.location.search` parse delivers that on a static-export hard load,
      whereas reverting to `router.query` would reintroduce the race and risk the
      deep-link opening at world view. Design updated accordingly.
- [x] 7.2 Keep `2e1b6ce` (album Back-restore + inferred deep-link flag) and
      `384c711` (ffprobe diagnostics)
- [x] 7.3 Run `cd enrichment && node --test` and the gallery production build
- [x] 7.5 Add the `e2e/` Playwright regression suite (`npm run e2e`) covering the
      zoom ladder + both fixed regressions; 6/6 pass locally.
- [ ] 7.4 PENDING (prod rollout, external): build + ship **both** enrichment images
      (indexer AND worker) + the gallery image; on prod `docker compose pull &&
      up -d`, then a **full** scan to backfill fine cells. Tracked as deployment.

## 8. Verify end-to-end — done LOCALLY (docker stack + test albums)

- [x] 8.1 World zoom: every populated region shows a visible hexbin (harness:
      `world-z2` → 9 hexbins, no missing groupings).
- [x] 8.2 Mid zoom: count circles; click opens the paged list (e2e popup test).
- [x] 8.3 Near zoom: sparse photos are individual thumbnails; a pile is one bubble.
- [x] 8.4 Click a pile → paged photos; header shows the true total.
- [x] 8.5 "View on map" deep-link focuses the spot; dense-pile bubble on-screen at
      max zoom (regression test) and a nearby loner separates from the pile.
- [ ] 8.6 Toggle "Show inferred locations" → counts/markers update accordingly
