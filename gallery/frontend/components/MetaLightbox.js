// vim: tabstop=2 shiftwidth=2 expandtab
//
// Reusable lightbox with the shared image-metadata overlay. Bundles the bits the
// album, search, and map views all want:
//   - Zoom + Download (download button), plus any extra `plugins`
//   - an "info" toolbar button that pins the metadata panel open
//   - the metadata panel (<ImageMeta>) as a fading slide footer, driven by
//     useTimedInfo (appears on view, auto-hides, stays when pinned)
//   - an optional favorite ★ toolbar button (when `favorite` is provided)
//
// Each slide should carry a `meta` object (the enrichment doc, or `{ path, … }`).
// Pass `plugins`/`extraButtons` for view-specific extras (e.g. Video + Slideshow
// in the album), `actions={(slide) => …}` for per-slide links, and
// `favorite={{ isFavorite, onToggle }}` to enable inline favoriting.

import { useState } from 'react';
import { Lightbox } from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Download from 'yet-another-react-lightbox/plugins/download';
import 'yet-another-react-lightbox/styles.css';

import ImageMeta, { InfoToggleButton, useTimedInfo } from './ImageMeta';

function slideKey(slide) {
  return (slide && (slide.meta?.path || slide.src)) || '';
}

function FavButton({ active, busy, onClick }) {
  return (
    <button
      type="button"
      className="yarl__button"
      aria-label={active ? 'Remove favorite' : 'Add favorite'}
      aria-pressed={active}
      title={active ? 'Unfavorite' : 'Favorite'}
      disabled={busy}
      onClick={onClick}
      style={{ color: active ? '#ffc107' : undefined, opacity: busy ? 0.5 : 1 }}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
      </svg>
    </button>
  );
}

export default function MetaLightbox({
  plugins = [],
  extraButtons = [],
  actions = null,
  favorite = null,
  on = {},
  slides,
  ...rest
}) {
  const info = useTimedInfo();
  const [current, setCurrent] = useState(0);
  // Optimistic favorite state, keyed by a stable slide identity (path/src) so it
  // survives parent re-renders (slides are rebuilt each render).
  const [favOverride, setFavOverride] = useState({});
  const [favBusy, setFavBusy] = useState(false);

  const curSlide = slides?.[current];
  const curKey = slideKey(curSlide);
  const isFav =
    favorite && curSlide
      ? favOverride[curKey] ?? !!favorite.isFavorite(curSlide)
      : false;

  const onFav = async () => {
    if (!favorite || !curSlide || favBusy) return;
    const next = !isFav;
    setFavBusy(true);
    setFavOverride((m) => ({ ...m, [curKey]: next }));
    let ok = false;
    try {
      ok = await favorite.onToggle(curSlide, next);
    } catch (_) {
      ok = false;
    }
    setFavBusy(false);
    if (!ok) setFavOverride((m) => ({ ...m, [curKey]: !next })); // revert
  };

  const buttons = [
    ...(favorite
      ? [<FavButton key="fav" active={isFav} busy={favBusy} onClick={onFav} />]
      : []),
    <InfoToggleButton key="info" active={info.pinned} onToggle={info.toggle} />,
    ...extraButtons,
    'download',
    'close',
  ];

  return (
    <Lightbox
      {...rest}
      slides={slides}
      plugins={[Zoom, Download, ...plugins]}
      on={{
        ...on,
        view: (props) => {
          setCurrent(props.index);
          info.reveal();
          on.view?.(props);
        },
      }}
      toolbar={{ buttons }}
      render={{
        slideFooter: ({ slide }) => (
          <ImageMeta
            meta={slide.meta}
            visible={info.visible}
            actions={actions ? actions(slide) : null}
          />
        ),
      }}
    />
  );
}
