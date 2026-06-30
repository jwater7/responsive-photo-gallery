// vim: tabstop=2 shiftwidth=2 expandtab
//
// Leaflet map of geotagged photos. The viewport IS the query: panning/zooming
// re-queries the enrichment API by bounding box and re-clusters. Markers are
// read-only photo thumbnails; clicking one opens the full image in a lightbox.
//
// Client-only (dynamically imported with ssr:false from pages/map.js).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import Supercluster from 'supercluster';
import 'leaflet/dist/leaflet.css';
import Video from 'yet-another-react-lightbox/plugins/video';
import { geoSearch } from '../../lib/enrich-api';
import { imageurl } from '../../lib/api';
import { imageRef } from '../../lib/image-ref';
import { docToSlide } from '../../lib/slide';
import { useFavoritesMulti } from '../../data/use-favorites';
import MetaLightbox from '../MetaLightbox';

const THUMB = '64x64';
// The pixel edge the THUMB renders at — the unit the cluster popup grid sizes
// from, so the popup dimensions track the thumbnail size instead of being magic.
const THUMB_PX = Number(THUMB.split('x')[0]);

// Edge length (px) of a photo thumb marker, hoisted out of thumbIcon so the
// icon size lives in one place.
const MARKER_SIZE = 48;

// Size of the cluster ("N photos here") popup, derived from the thumbnail grid:
// COLS thumbnails wide and up to ROWS tall before it scrolls. Bump COLS/ROWS to
// enlarge it (Leaflet's popup `maxWidth` is raised to match, since its 300px
// default would otherwise clamp the content).
const CLUSTER_POPUP_GAP = 4;
const CLUSTER_POPUP_COLS = 4;
const CLUSTER_POPUP_ROWS = 5;
const CLUSTER_POPUP_W =
  CLUSTER_POPUP_COLS * THUMB_PX + (CLUSTER_POPUP_COLS - 1) * CLUSTER_POPUP_GAP;
const CLUSTER_POPUP_MAXH =
  CLUSTER_POPUP_ROWS * THUMB_PX + (CLUSTER_POPUP_ROWS - 1) * CLUSTER_POPUP_GAP;

// OpenStreetMap serves tiles natively up to zoom 19 (a property of the tile
// source, not a tuned value); past that tiles only upscale, so that's our map
// ceiling. Clustering stays active all the way to that ceiling: points too
// close to separate even at the deepest zoom then remain a single *clickable*
// cluster (which opens the photo list) instead of dissolving into a pile of
// unclickable, exactly-stacked individual markers.
const TILE_MAX_NATIVE_ZOOM = 19;
const MAP_MAX_ZOOM = TILE_MAX_NATIVE_ZOOM;
const CLUSTER_MAX_ZOOM = MAP_MAX_ZOOM;

// Leaflet hands back map bounds that can run past the valid lat/lng range when
// zoomed out (e.g. lng < -180 at world zoom). MeiliSearch rejects an
// out-of-range _geoBoundingBox, so clamp before querying or clustering.
const clampLat = (v) => Math.max(-90, Math.min(90, v));
const clampLng = (v) => Math.max(-180, Math.min(180, v));

function thumbFor(doc, size = THUMB) {
  const ref = imageRef(doc);
  return ref ? imageurl({ ...ref, thumb: size }) : null;
}

// Lightbox slide from an enrichment doc — shared with search via lib/slide
// (video docs become fully-buffered Video slides; see MetaLightbox/BufferedVideo).
const toSlide = docToSlide;

function thumbIcon(doc) {
  const url = thumbFor(doc);
  const half = MARKER_SIZE / 2;
  const inner = url
    ? `<img src="${url}" style="width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;object-fit:cover;border-radius:6px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"/>`
    : `<div style="width:${half}px;height:${half}px;border-radius:50%;background:#2b8cff;border:2px solid #fff"></div>`;
  return L.divIcon({ html: inner, className: 'rpg-photo-marker', iconSize: [MARKER_SIZE, MARKER_SIZE], iconAnchor: [half, half] });
}

function clusterIcon(count) {
  const size = count < 10 ? 36 : count < 100 ? 44 : 52;
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#2b8cff;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.4)">${count}</div>`,
    className: 'rpg-cluster-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Tracks the map viewport and (debounced) queries the API for the visible area.
function ViewportSearch({ query, onResults }) {
  const map = useMap();
  const timer = useRef(null);

  const run = useCallback(() => {
    const b = map.getBounds();
    const body = {
      // MeiliSearch order: [topRight(maxLat,maxLng), bottomLeft(minLat,minLng)].
      // Clamp so a zoomed-out viewport never sends an out-of-range box.
      geoBoundingBox: [
        [clampLat(b.getNorth()), clampLng(b.getEast())],
        [clampLat(b.getSouth()), clampLng(b.getWest())],
      ],
      limit: 500,
      // Keyword filtering so a query removes non-matching pins from the area
      // (hybrid/semantic ranks rather than filters, which never drops a pin).
      semanticRatio: 0,
    };
    if (query) body.query = query;
    geoSearch(body)
      .then((r) => onResults(r.results || []))
      .catch(() => onResults([]));
  }, [map, query, onResults]);

  useMapEvents({
    moveend: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(run, 300);
    },
  });

  // Initial load and whenever the text query changes.
  useEffect(() => {
    run();
    return () => clearTimeout(timer.current);
  }, [run]);

  return null;
}

// A single photo pin on the map. `p` is the enrichment doc; clicking the
// thumb/link in its popup opens the lightbox. Its popup is *controlled* by the
// `open` prop (driven by the parent's `openHash`) rather than Leaflet's built-in
// click-to-open, so the selection survives re-clustering as you zoom: see
// <Markers>. Clicking the marker toggles it via `onSelect`.
function PhotoMarker({ p, position, onOpen, onSelect, onClose, open = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (open) ref.current?.openPopup();
    else ref.current?.closePopup();
  }, [open]);
  return (
    <Marker
      ref={ref}
      position={position}
      icon={thumbIcon(p)}
      eventHandlers={{ click: onSelect }}
    >
      <Popup closeButton={false} autoClose={false} closeOnClick={false}>
        <div style={{ maxWidth: 220 }}>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ float: 'right', border: 'none', background: 'none', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 0 }}
          >
            ×
          </button>
          <img
            src={thumbFor(p, '200x200')}
            onClick={() => onOpen(p)}
            alt={p.path}
            style={{ width: '100%', borderRadius: 4, cursor: 'pointer', display: 'block', marginBottom: 6 }}
          />
          <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{p.path}</div>
          {p.place && <div>{p.place}</div>}
          {p.tags && p.tags.length > 0 && (
            <div style={{ color: '#666', fontSize: 12 }}>{p.tags.join(', ')}</div>
          )}
          <a
            onClick={() => onOpen(p)}
            style={{ cursor: 'pointer', display: 'inline-block', marginTop: 4 }}
          >
            View full image
          </a>
        </div>
      </Popup>
    </Marker>
  );
}

// Build the Supercluster index for a result set.
function buildIndex(results) {
  const sc = new Supercluster({ radius: 60, maxZoom: CLUSTER_MAX_ZOOM });
  sc.load(
    results
      .filter((r) => r._geo && Number.isFinite(r._geo.lat) && Number.isFinite(r._geo.lng))
      .map((r) => ({
        type: 'Feature',
        properties: { cluster: false, ...r },
        geometry: { type: 'Point', coordinates: [r._geo.lng, r._geo.lat] },
      }))
  );
  return sc;
}

// A cluster rendered as a marker with a BOUND popup of the group's photos. Using
// a real Leaflet popup — instead of a free-floating corner panel — gives the same
// tail/arrow pointing at the cluster a single-photo bubble has, so it's obvious
// which circle the group belongs to. The popup is *controlled* by `open` (see
// <Markers>): the parent tracks the open group by a member photo's hash, so when
// zooming re-clusters the points the popup re-anchors to whatever marker now
// holds that photo instead of vanishing. Clicking toggles via `onSelect`.
function ClusterMarker({ position, count, photos, onOpen, onSelect, onClose, open = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (open) ref.current?.openPopup();
    else ref.current?.closePopup();
  }, [open]);
  return (
    <Marker
      ref={ref}
      position={position}
      icon={clusterIcon(count)}
      eventHandlers={{ click: onSelect }}
    >
      <Popup
        closeButton={false}
        autoClose={false}
        closeOnClick={false}
        maxWidth={CLUSTER_POPUP_W + 20}
      >
        <ClusterPhotos photos={photos} onOpen={onOpen} onClose={onClose} />
      </Popup>
    </Marker>
  );
}

// Renders clustered markers for the current results, bounds and zoom. `openHash`
// is a member photo's hash identifying the one open popup (or null); it's kept in
// the parent so the selection is stable across zoom-driven re-clustering. The
// marker that contains that photo at the current zoom shows the popup — whether
// that's a colocated cluster, a bigger merged cluster (zoomed out), or the photo
// as its own marker (zoomed in) — so the group "talk box" follows the photo
// instead of disappearing when the grouping changes.
function Markers({ index, onOpen, openHash, setOpenHash }) {
  const map = useMap();
  const [view, setView] = useState({ zoom: map.getZoom(), bounds: map.getBounds() });

  useMapEvents({
    moveend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }),
    zoomend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }),
    // Click on the map background (not a marker) dismisses the open group.
    click: () => setOpenHash(null),
  });

  const b = view.bounds;
  const clusters = index.getClusters(
    [clampLng(b.getWest()), clampLat(b.getSouth()), clampLng(b.getEast()), clampLat(b.getNorth())],
    Math.round(view.zoom)
  );

  return clusters.map((c) => {
    const [lng, lat] = c.geometry.coordinates;
    if (c.properties.cluster) {
      // The zoom at which this cluster breaks apart. Supercluster returns
      // maxZoom + 1 for points it can never separate (same/near-identical
      // coords); that's beyond the map ceiling.
      const expansionZoom = index.getClusterExpansionZoom(c.id);
      const colocated = expansionZoom > MAP_MAX_ZOOM;
      // Need the leaves to show a popup (colocated), or to test whether this
      // cluster is the one currently open (membership of `openHash`).
      const leaves =
        colocated || openHash
          ? index.getLeaves(c.id, Infinity).map((leaf) => leaf.properties)
          : null;
      const holdsOpen = !!openHash && !!leaves && leaves.some((p) => p.hash === openHash);
      if (colocated || holdsOpen) {
        // Colocated (can't split), OR the open group lives here at this zoom:
        // show the group in a popup tied to this cluster.
        return (
          <ClusterMarker
            key={`cluster-${c.id}`}
            position={[lat, lng]}
            count={c.properties.point_count}
            photos={leaves}
            onOpen={onOpen}
            open={holdsOpen}
            onSelect={() => setOpenHash(holdsOpen ? null : leaves[0].hash)}
            onClose={() => setOpenHash(null)}
          />
        );
      }
      // Separable, and not the open group: clicking zooms to where it splits.
      return (
        <Marker
          key={`cluster-${c.id}`}
          position={[lat, lng]}
          icon={clusterIcon(c.properties.point_count)}
          eventHandlers={{ click: () => map.setView([lat, lng], expansionZoom) }}
        />
      );
    }
    const hash = c.properties.hash;
    return (
      <PhotoMarker
        key={hash}
        p={c.properties}
        position={[lat, lng]}
        onOpen={onOpen}
        open={openHash === hash}
        onSelect={() => setOpenHash(openHash === hash ? null : hash)}
        onClose={() => setOpenHash(null)}
      />
    );
  });
}

// The scrollable thumbnail grid shown inside a cluster's popup. Clicking a thumb
// opens it (with the whole group as slides) in the lightbox. Scales to hundreds
// where fanning markers out would still overlap.
function ClusterPhotos({ photos, onOpen, onClose }) {
  return (
    <div style={{ width: CLUSTER_POPUP_W }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <span style={{ fontWeight: 600 }}>{photos.length} photos here</span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ border: 'none', background: 'none', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 0 }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, ${THUMB_PX}px)`,
          gap: CLUSTER_POPUP_GAP,
          maxHeight: CLUSTER_POPUP_MAXH,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {photos.map((p) => (
          <img
            key={p.hash}
            src={thumbFor(p)}
            title={p.path}
            onClick={() => onOpen(p, photos)}
            alt={p.path}
            style={{ width: THUMB_PX, height: THUMB_PX, objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }}
          />
        ))}
      </div>
    </div>
  );
}

export default function MapView({ initial = null }) {
  const [results, setResults] = useState([]);
  const [query, setQuery] = useState('');
  const [input, setInput] = useState('');
  // Lightbox state: { slides, index } or null. Opening from a colocated group
  // passes the whole group as slides so the arrows page through all of them;
  // opening a lone marker passes just that one.
  const [lb, setLb] = useState(null);
  // The one open marker/cluster popup, identified by a member photo's hash (null
  // = none). Tracking it by a stable photo hash — not the volatile per-zoom
  // cluster id — lets the popup follow its grouping across zoom instead of
  // disappearing when the points re-cluster. Seeded from a deep-link `hash` so
  // "View on map" opens the photo's group on arrival.
  const [openHash, setOpenHash] = useState(initial?.hash || null);
  // Caption-inferred pins (geo_source "inferred") are lower-confidence, so they're
  // hidden until the user opts in via the checkbox.
  const [showInferred, setShowInferred] = useState(false);
  const favorites = useFavoritesMulti(results);

  const visibleResults = useMemo(
    () => (showInferred ? results : results.filter((r) => r.geo_source !== 'inferred')),
    [results, showInferred]
  );

  // One clustering for the markers (a colocated cluster renders its group in a
  // popup bound to its marker; the open group's popup follows it across zoom).
  const index = useMemo(() => buildIndex(visibleResults), [visibleResults]);

  // Reflect the open image in the URL (replaceState, so no history push / router
  // re-trigger) so a refresh restores it. Also pins the slide's coords so the
  // viewport re-query on reload includes that photo. Passing null clears `img`.
  const setDeepLink = useCallback((slide) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const meta = slide?.meta;
    if (meta) {
      url.searchParams.set('img', meta.hash);
      const g = meta._geo;
      if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
        url.searchParams.set('lat', g.lat);
        url.searchParams.set('lng', g.lng);
        if (!url.searchParams.get('z')) url.searchParams.set('z', '16');
      }
    } else {
      url.searchParams.delete('img');
    }
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const openImage = useCallback(
    (p, group) => {
      const photos = group && group.length ? group : [p];
      const slides = photos.map(toSlide).filter(Boolean);
      if (!slides.length) return;
      const idx = slides.findIndex((s) => s.meta.hash === p.hash);
      const i = idx < 0 ? 0 : idx;
      setLb({ slides, index: i });
      setDeepLink(slides[i]);
    },
    [setDeepLink]
  );

  // Restore the lightbox from ?img= once its photo is in the (viewport) results.
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (openedFromUrl.current || !initial?.img || !results.length) return;
    const p = results.find((r) => r.hash === initial.img);
    if (p) {
      openedFromUrl.current = true;
      openImage(p);
    }
  }, [initial, results, openImage]);

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
        <input
          type="checkbox"
          checked={showInferred}
          onChange={(e) => setShowInferred(e.target.checked)}
        />
        Show inferred locations
      </label>

      <MapContainer
        center={initial && Number.isFinite(initial.lat) ? [initial.lat, initial.lng] : [20, 0]}
        // Deep-linking a specific photo (a `hash` from "View on map") opens at
        // max zoom, where only genuinely colocated photos still cluster — so the
        // target is its own marker (popup) or its true group (list), never lost
        // in a big mixed cluster. A plain shared link keeps its own zoom.
        zoom={
          initial && Number.isFinite(initial.lat)
            ? (initial.hash ? MAP_MAX_ZOOM : initial.zoom)
            : 2
        }
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
        <ViewportSearch key={query} query={query} onResults={setResults} />
        <Markers index={index} onOpen={openImage} openHash={openHash} setOpenHash={setOpenHash} />
      </MapContainer>

      <MetaLightbox
        open={!!lb}
        close={() => {
          setLb(null);
          setDeepLink(null);
        }}
        index={lb?.index ?? 0}
        slides={lb?.slides ?? []}
        plugins={[Video]}
        on={{ view: ({ index: i }) => setDeepLink(lb?.slides?.[i]) }}
        favorite={{
          isFavorite: (slide) => favorites.isFavorite(slide.meta),
          onToggle: (slide, next) => favorites.toggle(slide.meta, next),
        }}
      />
    </div>
  );
}
