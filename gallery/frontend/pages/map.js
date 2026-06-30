// vim: tabstop=2 shiftwidth=2 expandtab
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Breadcrumb } from 'react-bootstrap';

import { usePing } from '../data/use-ping';

// Leaflet touches `window`, so load the map client-side only (also keeps the
// heavy map bundle out of the rest of the gallery).
const MapView = dynamic(() => import('../components/map/MapView'), {
  ssr: false,
  loading: () => <>Loading map…</>,
});

export default function MapPage() {
  const { loggedIn, isLoading: isPingLoading, features } = usePing({ redirect: '/' });

  // Optional deep-link: /map?lat=..&lng=..&z=..&hash=.. opens the map focused on
  // one photo (e.g. the lightbox "View on map" action). `img` (an image hash)
  // additionally reopens the lightbox on that photo — so a refresh while viewing
  // an image restores it. null = default world view.
  //
  // Parsed from window.location once on mount, NOT from router.query: in the
  // static export (output: 'export'), a hard load / shared link flips
  // router.isReady true while router.query is still empty, so a deep-link mounted
  // the map at the default world view (Leaflet reads center/zoom once at mount,
  // so it never re-focused). window.location.search is the ground truth on the
  // client. `undefined` = not parsed yet (don't mount the map); `null` = parsed,
  // no deep-link (world view).
  const [initial, setInitial] = useState(undefined);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const img = p.get('img');
    const lat = parseFloat(p.get('lat'));
    const lng = parseFloat(p.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setInitial(img ? { img } : null);
      return;
    }
    const z = parseInt(p.get('z'), 10);
    setInitial({
      lat,
      lng,
      zoom: Number.isFinite(z) ? z : 16,
      hash: p.get('hash') || null,
      // "View on map" of a caption-inferred photo asks the map to show inferred
      // pins, so the deep-linked photo isn't filtered out on arrival.
      inferred: p.get('inferred') === '1',
      img: img || null,
    });
  }, []);

  // Wait for the deep-link parse (initial !== undefined) before mounting MapView,
  // so Leaflet's one-shot center/zoom read sees the focused view, not the default.
  if (isPingLoading || initial === undefined) return <></>;
  if (!loggedIn) return <>Redirecting...</>;

  if (!features.map) {
    return (
      <div>
        <Breadcrumb>
          <Breadcrumb.Item active>Map</Breadcrumb.Item>
        </Breadcrumb>
        <p>The map is currently unavailable.</p>
      </div>
    );
  }

  return (
    <div>
      <Breadcrumb>
        <Breadcrumb.Item active>Map</Breadcrumb.Item>
      </Breadcrumb>
      <MapView initial={initial} />
    </div>
  );
}
