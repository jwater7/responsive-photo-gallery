// vim: tabstop=2 shiftwidth=2 expandtab
//
// Lightbox action that deep-links the in-app map to a photo's location. Supplied
// as `actions` to <MetaLightbox> by the album/search views. Renders nothing when
// the image has no usable coordinates, or when the map feature is unavailable
// (degraded operation) — so it never links to a dead map.

import Router from 'next/router';

import { usePing } from '../data/use-ping';

export default function ViewOnMapAction({ meta }) {
  // SWR-cached under the shared ping key, so this adds no extra request.
  const { features } = usePing();
  const geo = meta?._geo;

  if (!features.map) return null; // map degraded / unavailable
  if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return null;

  const go = (e) => {
    e.stopPropagation();
    Router.push({
      pathname: '/map',
      query: { lat: geo.lat, lng: geo.lng, z: 16, hash: meta.hash },
    });
  };

  return (
    <a
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter') go(e);
      }}
      style={{ color: '#6cb2ff', cursor: 'pointer' }}
    >
      🗺 View on map
    </a>
  );
}
