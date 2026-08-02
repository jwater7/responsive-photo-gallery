// vim: tabstop=2 shiftwidth=2 expandtab
//
// Lightbox action that deep-links back into the album grid, scrolled to the
// month group the photo belongs to — the inverse of <ViewOnMapAction>. Supplied
// as `actions` to <MetaLightbox> by the map (and search) views, so a photo found
// by place can be put back in the context of the ones taken around it.
//
// Uses `at=` rather than the album's `image=` deep-link on purpose: `image=`
// opens the lightbox on that photo, which is the view the user is leaving. `at=`
// lands on the grid.
//
// Renders nothing when the doc isn't album-addressable (imageRef returns null on
// an album/path mismatch rather than guessing), so it never links nowhere.

import Router from 'next/router';

import { imageRef } from '../lib/image-ref';

export default function ViewInAlbumAction({ meta }) {
  const ref = imageRef(meta);
  if (!ref) return null;

  const go = (e) => {
    e.stopPropagation();
    Router.push({
      pathname: '/album',
      query: { album: ref.album, at: ref.image },
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
      🗂 View in album
    </a>
  );
}
