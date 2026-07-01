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

function thumbIcon(doc) {
  const url = thumbFor(doc);
  const half = MARKER_SIZE / 2;
  const inner = url
    ? `<img src="${url}" style="width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;object-fit:cover;border-radius:6px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"/>`
    : `<div style="width:${half}px;height:${half}px;border-radius:50%;background:#2b8cff;border:2px solid #fff"></div>`;
  return L.divIcon({ html: inner, className: 'rpg-photo-marker', iconSize: [MARKER_SIZE, MARKER_SIZE], iconAnchor: [half, half] });
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
  const [layer, setLayer] = useState({ mode: 'circle', resolution: 8, cells: [], denseCells: [], sparseDocs: [] });
  const [openCell, setOpenCell] = useState(null);
  const timer = useRef(null);
  const deepLinkDone = useRef(false);

  const refresh = useCallback(async () => {
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
        setLayer({ mode, resolution, cells: [], denseCells: dense, sparseDocs: (sr.results || []).filter((d) => d._geo && Number.isFinite(d._geo.lat)) });
      } else {
        setLayer({ mode, resolution, cells: density.cells || [], denseCells: [], sparseDocs: [] });
      }
    } catch {
      onTotal(0);
      setLayer((l) => ({ ...l, cells: [], denseCells: [], sparseDocs: [] }));
    }
  }, [map, query, excludeInferred, onTotal]);

  useMapEvents({
    moveend: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 300);
    },
    // A click on the map background dismisses the open cell popup.
    click: () => setOpenCell(null),
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

  // "View on map" deep-link: once the cells around the target load, open the cell
  // that contains it (works no matter how dense the location is).
  useEffect(() => {
    if (deepLinkDone.current) return;
    if (!initial || !Number.isFinite(initial.lat) || !initial.hash) return;
    const candidates = [...(layer.cells || []), ...(layer.denseCells || [])];
    const cell = candidates.find((c) => c.hexagon && pointInRing(initial.lat, initial.lng, c.hexagon));
    if (cell) {
      deepLinkDone.current = true;
      setOpenCell(cell);
    }
  }, [layer, initial]);

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
          <Marker key={c.cell} position={[c.center.lat, c.center.lng]} icon={countIcon(c.count)} eventHandlers={{ click: () => setOpenCell(c) }} />
        ))}

      {layer.mode === 'thumbnail' && (
        <>
          {layer.denseCells.map((c) => (
            <Marker key={c.cell} position={[c.center.lat, c.center.lng]} icon={countIcon(c.count)} eventHandlers={{ click: () => setOpenCell(c) }} />
          ))}
          {layer.sparseDocs.map((d) => (
            <Marker key={d.hash} position={[d._geo.lat, d._geo.lng]} icon={thumbIcon(d)} eventHandlers={{ click: () => openImage(d, null) }} />
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
            key={openCell.cell}
            resolution={layer.resolution}
            cell={openCell.cell}
            count={openCell.count}
            excludeInferred={excludeInferred}
            onOpen={openImage}
            onClose={() => setOpenCell(null)}
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
