// vim: tabstop=2 shiftwidth=2 expandtab
//
// Leaflet map of geotagged photos, rendered from SERVER-SIDE density (true counts
// per H3 cell), never a client sample. Representation follows zoom:
//   far  → hexbins colored by count (click = zoom in)
//   mid  → count circles           (click = open the cell's paged photo list)
//   near → individual thumbnails + a circle for any dense cell
// See map-config.js for the thresholds / resolution ladder / color buckets.
//
// Client-only (dynamically imported with ssr:false from pages/map.js).

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Video from 'yet-another-react-lightbox/plugins/video';

import { geoDensity, geoSearch } from '../../lib/enrich-api';
import { imageurl } from '../../lib/api';
import { imageRef } from '../../lib/image-ref';
import { docToSlide } from '../../lib/slide';
import { useFavoritesMulti } from '../../data/use-favorites';
import MetaLightbox from '../MetaLightbox';
import CellPhotos, { CELL_POPUP_WIDTH } from './CellPhotos';
import {
  DEEP_LINK_ZOOM,
  CELL_THUMB_LIMIT,
  NEAR_SPARSE_LIMIT,
  resolutionForZoom,
  modeForZoom,
  bucketColor,
  ringBounds,
  pointInRing,
} from './map-config';

// OSM serves tiles natively to zoom 19; past that they only upscale.
const TILE_MAX_NATIVE_ZOOM = 19;
const MAP_MAX_ZOOM = 19;
const MARKER_SIZE = 44;

// Leaflet bounds can run past valid lat/lng when zoomed out; MeiliSearch rejects
// an out-of-range _geoBoundingBox, so clamp before querying.
const clampLat = (v) => Math.max(-90, Math.min(90, v));
const clampLng = (v) => Math.max(-180, Math.min(180, v));

const fmt = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

function thumbFor(doc) {
  const ref = imageRef(doc);
  return ref ? imageurl({ ...ref, thumb: '64x64' }) : null;
}

// A single photo thumbnail marker. `count` > 1 badges it as a co-located pile
// (photos sharing one GPS fix that would otherwise stack invisibly — see
// coLocatedPiles); clicking such a marker opens the whole pile in the lightbox.
function thumbIcon(doc, count = 1) {
  const url = thumbFor(doc);
  const half = MARKER_SIZE / 2;
  const inner = url
    ? `<img src="${url}" style="width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;object-fit:cover;border-radius:6px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"/>`
    : `<div style="width:${half}px;height:${half}px;border-radius:50%;background:#2b8cff;border:2px solid #fff"></div>`;
  const badge =
    count > 1
      ? `<div style="position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;background:#d7301f;color:#fff;font-size:11px;font-weight:700;line-height:14px;text-align:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${count}</div>`
      : '';
  return L.divIcon({
    html: `<div style="position:relative;width:${MARKER_SIZE}px;height:${MARKER_SIZE}px">${inner}${badge}</div>`,
    className: 'rpg-photo-marker',
    iconSize: [MARKER_SIZE, MARKER_SIZE],
    iconAnchor: [half, half],
  });
}

// Group sparse docs that share (essentially) the same coordinate. Without this,
// photos taken at one spot (a burst, or repeated shots — same GPS fix) render as
// individual markers stacked exactly on top of each other at the deepest zoom, so
// all but the topmost are invisible even though the cell count is correct. 6 dp
// (~0.1 m) treats only a genuinely-identical fix as one pile; distinct nearby
// photos still get their own marker. Returns [{ lat, lng, docs: [...] }].
function coLocatedPiles(docs) {
  const byCoord = new Map();
  for (const d of docs) {
    const key = `${d._geo.lat.toFixed(6)},${d._geo.lng.toFixed(6)}`;
    let pile = byCoord.get(key);
    if (!pile) {
      pile = { lat: d._geo.lat, lng: d._geo.lng, docs: [] };
      byCoord.set(key, pile);
    }
    pile.docs.push(d);
  }
  return [...byCoord.values()];
}

// A count "bubble" for a cell, colored by the same log buckets as the hexbins.
function countIcon(count) {
  const size = count < 10 ? 34 : count < 100 ? 42 : count < 1000 ? 50 : 58;
  const color = bucketColor(count);
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.4);font-size:12px">${fmt(count)}</div>`,
    className: 'rpg-cell-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Density + rendering. Lives inside MapContainer so it has the live map (bounds,
// zoom, click-to-zoom). Refetches (debounced) on move and when the query or the
// inferred filter changes.
function MapContent({ query, excludeInferred, initial, onOpenLightbox, onTotal }) {
  const map = useMap();
  const [layer, setLayer] = useState({ mode: 'circle', resolution: 8, cells: [], denseCells: [], sparsePiles: [] });
  // The popup tracks a stable anchor COORDINATE, not a captured cell — the cell it
  // resolves to is derived from the current layer each render (see openCell below),
  // so it follows the location across zoom instead of going stale.
  const [openAnchor, setOpenAnchor] = useState(null);
  const timer = useRef(null);
  const deepLinkDone = useRef(false);
  // Monotonic id of the newest refresh. Thumbnail mode is two sequential
  // awaits, so a slow superseded refresh (pre-pan/zoom bounds) could resolve
  // after a faster newer one and repaint the layer + "in view" total for a
  // stale viewport. Stale responses drop out instead.
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    const zoom = map.getZoom();
    const mode = modeForZoom(zoom);
    const resolution = resolutionForZoom(zoom);
    const b = map.getBounds();
    const bbox = [
      // MeiliSearch order: [topRight(maxLat,maxLng), bottomLeft(minLat,minLng)].
      [clampLat(b.getNorth()), clampLng(b.getEast())],
      [clampLat(b.getSouth()), clampLng(b.getWest())],
    ];
    try {
      const density = await geoDensity({ geoBoundingBox: bbox, resolution, excludeInferred, query });
      if (seq !== seqRef.current) return; // superseded — drop the stale viewport
      onTotal(density.total ?? 0);
      if (mode === 'thumbnail') {
        // Near zoom uses a FINE resolution (see the zoom→res ladder), so a dense
        // cell is small: its true count comes from the density facet (correct even
        // for >500-photo piles — the facet is server-side, uncapped), its bubble
        // sits at the fine cell's center (on-screen at this zoom), and it's
        // EXCLUDED from the doc fetch so the pile can't eat the budget. The
        // remaining sparse photos come back as real docs → individual thumbnails,
        // each in its own fine cell so a loner never lumps into a neighbouring pile.
        const dense = (density.cells || []).filter((c) => c.count > CELL_THUMB_LIMIT);
        const denseIds = dense.map((c) => c.cell);
        const sr = await geoSearch({
          geoBoundingBox: bbox,
          filter: denseIds.length ? [`cell_r${resolution} NOT IN [${denseIds.map((id) => `"${id}"`).join(', ')}]`] : undefined,
          excludeInferred,
          query,
          semanticRatio: 0,
          limit: NEAR_SPARSE_LIMIT,
        });
        if (seq !== seqRef.current) return;
        const geoDocs = (sr.results || []).filter(
          (d) => d._geo && Number.isFinite(d._geo.lat) && Number.isFinite(d._geo.lng)
        );
        setLayer({ mode, resolution, cells: [], denseCells: dense, sparsePiles: coLocatedPiles(geoDocs) });
      } else {
        setLayer({ mode, resolution, cells: density.cells || [], denseCells: [], sparsePiles: [] });
      }
    } catch {
      if (seq !== seqRef.current) return;
      onTotal(0);
      setLayer((l) => ({ ...l, cells: [], denseCells: [], sparsePiles: [] }));
    }
  }, [map, query, excludeInferred, onTotal]);

  useMapEvents({
    moveend: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 300);
    },
    // A click on the map background dismisses the open cell popup.
    click: () => setOpenAnchor(null),
  });

  // Initial load + refetch when the query/filter change.
  useEffect(() => {
    refresh();
    return () => clearTimeout(timer.current);
  }, [refresh]);

  const openImage = useCallback(
    (doc, group) => {
      const arr = group && group.length ? group : [doc];
      const slides = arr.map(docToSlide).filter(Boolean);
      if (!slides.length) return;
      let index = slides.findIndex((s) => s.meta.hash === doc.hash);
      if (index < 0) index = 0;
      onOpenLightbox({ slides, index });
    },
    [onOpenLightbox]
  );

  // "View on map" deep-link: anchor the popup at the target coordinate so it opens
  // on the containing cell and FOLLOWS that spot as you zoom (the resolved cell
  // changes with zoom; the point of interest doesn't). Set once, so a manual close
  // sticks and it doesn't re-open on the next refetch.
  useEffect(() => {
    if (deepLinkDone.current) return;
    if (!initial || !Number.isFinite(initial.lat) || !initial.hash) return;
    deepLinkDone.current = true;
    setOpenAnchor({ lat: initial.lat, lng: initial.lng });
  }, [initial]);

  // Resolve the anchor to a cell of the CURRENT layer every render: the popup
  // re-homes onto whichever circle/hexbin now covers the anchor (its photo list
  // refreshes with it), rather than detaching. null when nothing at this zoom
  // covers it (e.g. the spot resolved to loose thumbnails), which closes the popup.
  const openCell = openAnchor
    ? [...(layer.cells || []), ...(layer.denseCells || [])].find(
        (c) => c.hexagon && pointInRing(openAnchor.lat, openAnchor.lng, c.hexagon)
      ) || null
    : null;

  return (
    <>
      {layer.mode === 'hexbin' &&
        layer.cells.map((c) => (
          <Polygon
            key={c.cell}
            positions={c.hexagon}
            pathOptions={{ color: bucketColor(c.count), weight: 1, fillColor: bucketColor(c.count), fillOpacity: 0.55 }}
            eventHandlers={{ click: () => map.fitBounds(ringBounds(c.hexagon)) }}
          >
            <Tooltip>{fmt(c.count)} photos</Tooltip>
          </Polygon>
        ))}

      {layer.mode === 'circle' &&
        layer.cells.map((c) => (
          <Marker key={c.cell} position={[c.center.lat, c.center.lng]} icon={countIcon(c.count)} eventHandlers={{ click: () => setOpenAnchor(c.center) }} />
        ))}

      {layer.mode === 'thumbnail' && (
        <>
          {layer.denseCells.map((c) => (
            <Marker key={c.cell} position={[c.center.lat, c.center.lng]} icon={countIcon(c.count)} eventHandlers={{ click: () => setOpenAnchor(c.center) }} />
          ))}
          {layer.sparsePiles.map((p) => (
            <Marker
              key={p.docs[0].hash}
              position={[p.lat, p.lng]}
              icon={thumbIcon(p.docs[0], p.docs.length)}
              eventHandlers={{ click: () => openImage(p.docs[0], p.docs) }}
            />
          ))}
        </>
      )}

      {openCell && (
        <Popup
          position={[openCell.center.lat, openCell.center.lng]}
          closeButton={false}
          autoClose={false}
          closeOnClick={false}
          maxWidth={CELL_POPUP_WIDTH + 24}
        >
          <CellPhotos
            // The filter is part of the key: CellPhotos pages with an internal
            // offset over the FILTERED set, so toggling "Show inferred" while
            // the popup is open must remount it (fresh page 0 under the new
            // filter) — a prop change alone left the loaded grid and paging
            // offset on the old filter while the header count used the new one.
            key={`${openCell.cell}|${excludeInferred ? 1 : 0}`}
            resolution={layer.resolution}
            cell={openCell.cell}
            count={openCell.count}
            excludeInferred={excludeInferred}
            onOpen={openImage}
            onClose={() => setOpenAnchor(null)}
          />
        </Popup>
      )}
    </>
  );
}

export default function MapView({ initial = null }) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  // Inferred pins are hidden by default; a "View on map" deep-link to an inferred
  // photo opts in for that arrival (see ViewOnMapAction / pages/map.js).
  const [showInferred, setShowInferred] = useState(Boolean(initial?.inferred));
  const [lb, setLb] = useState(null);
  const [total, setTotal] = useState(null);
  const favorites = useFavoritesMulti(lb?.slides?.map((s) => s.meta) || []);

  const hasDeep = initial && Number.isFinite(initial.lat) && Number.isFinite(initial.lng);

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 120px)', minHeight: 400 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(input.trim());
        }}
        style={{ position: 'absolute', zIndex: 1000, top: 10, left: 60, display: 'flex', gap: 6 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search this area…"
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ccc', width: 260 }}
        />
        <button type="submit" className="btn btn-primary btn-sm">
          Search
        </button>
      </form>

      <label
        style={{
          position: 'absolute',
          zIndex: 1000,
          top: 48,
          left: 60,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid #ccc',
          background: 'rgba(255,255,255,0.92)',
          fontSize: 13,
          cursor: 'pointer',
        }}
        title="Show photos whose location was inferred from their caption text (lower confidence)."
      >
        <input type="checkbox" checked={showInferred} onChange={(e) => setShowInferred(e.target.checked)} />
        Show inferred locations
      </label>

      {typeof total === 'number' && (
        <div
          style={{
            position: 'absolute',
            zIndex: 1000,
            top: 10,
            right: 10,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid #ccc',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {total.toLocaleString()} in view
        </div>
      )}

      <MapContainer
        center={hasDeep ? [initial.lat, initial.lng] : [20, 0]}
        zoom={hasDeep ? (Number.isFinite(initial.zoom) ? initial.zoom : DEEP_LINK_ZOOM) : 2}
        maxZoom={MAP_MAX_ZOOM}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={MAP_MAX_ZOOM}
          maxNativeZoom={TILE_MAX_NATIVE_ZOOM}
        />
        <MapContent
          query={query}
          excludeInferred={!showInferred}
          initial={initial}
          onOpenLightbox={setLb}
          onTotal={setTotal}
        />
      </MapContainer>

      <MetaLightbox
        open={!!lb}
        close={() => setLb(null)}
        index={lb?.index ?? 0}
        slides={lb?.slides ?? []}
        plugins={[Video]}
        favorite={{
          isFavorite: (slide) => favorites.isFavorite(slide.meta),
          onToggle: (slide, next) => favorites.toggle(slide.meta, next),
        }}
      />
    </div>
  );
}
