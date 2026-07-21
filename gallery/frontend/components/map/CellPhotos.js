// vim: tabstop=2 shiftwidth=2 expandtab
//
// The paged photo grid shown inside a cell's popup. Fetches by exact H3 cell id
// (`cell_r<res> = <cell>`), so a dense location (thousands of photos) is fully
// browsable via offset paging — not capped at a viewport sample. Reuses the
// infinite-scroll shape from pages/search.js. Fixed size; the scroll area pages.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { geoSearch } from '../../lib/enrich-api';
import { imageurl } from '../../lib/api';
import { imageRef } from '../../lib/image-ref';
import { POPUP_PAGE_SIZE } from './map-config';

const THUMB = '64x64';
const THUMB_PX = 64;
const COLS = 4;
const GAP = 4;
const W = COLS * THUMB_PX + (COLS - 1) * GAP;
const MAXH = 5 * THUMB_PX + 4 * GAP;

export const CELL_POPUP_WIDTH = W;

export default function CellPhotos({ resolution, cell, count, excludeInferred, onOpen, onClose, onFirstPage }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const offsetRef = useRef(0);
  // Re-entry guard must be a ref, not the `loading` state: the mount fetch and
  // the IntersectionObserver's initial callback can both fire from the same
  // render, where both closures still see loading=false — the two page-0
  // requests then both append (duplicated grid) and double-advance the offset.
  const inFlightRef = useRef(false);
  const docsRef = useRef([]);
  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);

  const loadMore = useCallback(async () => {
    if (inFlightRef.current || done) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const r = await geoSearch({
        filter: [`cell_r${resolution} = "${cell}"`],
        excludeInferred,
        limit: POPUP_PAGE_SIZE,
        offset: offsetRef.current,
      });
      const raw = r.results || [];
      offsetRef.current += raw.length;
      setDocs((prev) => [...prev, ...raw.filter((d) => imageRef(d))]);
      if (raw.length < POPUP_PAGE_SIZE) setDone(true);
    } catch {
      setDone(true);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [resolution, cell, excludeInferred, done]);

  // First page on mount. The popup is remounted per cell (keyed), so this is a
  // one-shot fetch of page 0.
  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaflet measured (and auto-panned for) the popup when it opened around the
  // small "Loading…" box; the grid arriving here grows the popup upward inside
  // a React portal, which Leaflet can't see — near the top of the viewport the
  // header/close button end up clipped off-screen. Signal the parent to call
  // popup.update() (re-measure + auto-pan) once the first page is in the DOM.
  // Once is enough: the grid's height is final after page 0 (it caps at 5 rows
  // and scrolls), so later pages can't yank the map mid-scroll. Layout effect,
  // so the re-measure sees the grown grid before paint.
  const sizedRef = useRef(false);
  useLayoutEffect(() => {
    if (sizedRef.current || !docs.length) return;
    sizedRef.current = true;
    if (onFirstPage) onFirstPage();
  }, [docs.length, onFirstPage]);

  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { root: el.parentElement, rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [done, loadMore, docs.length]);

  return (
    <div style={{ width: W }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>
          {count} photo{count === 1 ? '' : 's'} here
        </span>
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
          gridTemplateColumns: `repeat(${COLS}, ${THUMB_PX}px)`,
          gap: GAP,
          maxHeight: MAXH,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {docs.map((d) => (
          <img
            key={d.hash}
            src={imageurl({ ...imageRef(d), thumb: THUMB })}
            title={d.path}
            alt={d.path}
            onClick={() => onOpen(d, docsRef.current)}
            style={{ width: THUMB_PX, height: THUMB_PX, objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }}
          />
        ))}
        <div ref={sentinelRef} style={{ gridColumn: '1 / -1', height: 1 }} />
        {loading && (
          <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#666', textAlign: 'center' }}>Loading…</div>
        )}
      </div>
    </div>
  );
}
