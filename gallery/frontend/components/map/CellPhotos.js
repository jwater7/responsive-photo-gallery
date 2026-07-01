// vim: tabstop=2 shiftwidth=2 expandtab
//
// The paged photo grid shown inside a cell's popup. Fetches by exact H3 cell id
// (`cell_r<res> = <cell>`), so a dense location (thousands of photos) is fully
// browsable via offset paging — not capped at a viewport sample. Reuses the
// infinite-scroll shape from pages/search.js. Fixed size; the scroll area pages.

import { useCallback, useEffect, useRef, useState } from 'react';

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

export default function CellPhotos({ resolution, cell, count, excludeInferred, onOpen, onClose }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const offsetRef = useRef(0);
  const docsRef = useRef([]);
  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);

  const loadMore = useCallback(async () => {
    if (loading || done) return;
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
      setLoading(false);
    }
  }, [resolution, cell, excludeInferred, loading, done]);

  // First page on mount. The popup is remounted per cell (keyed), so this is a
  // one-shot fetch of page 0.
  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
