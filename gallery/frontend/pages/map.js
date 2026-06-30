// vim: tabstop=2 shiftwidth=2 expandtab
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { useRouter } from 'next/router';
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
  const router = useRouter();

  // Optional deep-link: /map?lat=..&lng=..&z=..&hash=.. opens the map focused on
  // one photo (e.g. the lightbox "View on map" action). `img` (an image hash)
  // additionally reopens the lightbox on that photo — so a refresh while viewing
  // an image restores it. null = default world view.
  const initial = useMemo(() => {
    const img = typeof router.query.img === 'string' ? router.query.img : null;
    const lat = parseFloat(router.query.lat);
    const lng = parseFloat(router.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return img ? { img } : null;
    const z = parseInt(router.query.z, 10);
    return {
      lat,
      lng,
      zoom: Number.isFinite(z) ? z : 16,
      hash: typeof router.query.hash === 'string' ? router.query.hash : null,
      // "View on map" of a caption-inferred photo asks the map to show inferred
      // pins, so the deep-linked photo isn't filtered out on arrival.
      inferred: router.query.inferred === '1',
      img,
    };
  }, [router.query]);

  // Leaflet reads center/zoom once at mount, so wait for the router to parse the
  // query before mounting MapView — otherwise a deep-link opens at the default
  // view on a cold load.
  if (isPingLoading || !router.isReady) return <></>;
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
