// vim: tabstop=2 shiftwidth=2 expandtab
//
// Search across ALL enriched images (not just the geotagged ones on the map).
// Renders matches in the same photo-grid + lightbox the album view uses.
// Additive feature: gated by the runtime `search` flag; remove pages/search.js
// and the navbar link to disable.

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Router from 'next/router';
import { useSearchParams } from 'next/navigation';
import { Breadcrumb, Container, Row, Col, Form, Button } from 'react-bootstrap';
import { usePing } from '../data/use-ping';
import { useFavoritesMulti } from '../data/use-favorites';
import Video from 'yet-another-react-lightbox/plugins/video';
import { geoSearch } from '../lib/enrich-api';
import { imageurl } from '../lib/api';
import { imageRef } from '../lib/image-ref';
import { docToSlide } from '../lib/slide';
import MetaLightbox from '../components/MetaLightbox';
import ViewOnMapAction from '../components/ViewOnMapAction';

const THUMB = '150x150';

// One page of results per request. The grid pages in more as you scroll, using
// the backend's offset, so the old hard 100-result ceiling is gone — all matches
// are reachable. A page that comes back smaller than this means the end.
const PAGE_SIZE = 100;

// "Smart" (semantic) search blends the local CLIP embedding with keyword
// matching and drops weak matches via a relevance threshold, so it filters to
// what the photos actually depict (even with no matching text/tags). The
// threshold is tuned for the default CLIP model; raise it to be stricter.
const SMART_SEMANTIC_RATIO = 0.6;
const SMART_SCORE_THRESHOLD = 0.62;

// Result ordering the user can pick. 'relevance' (default) sends no `sort`, so
// the backend keeps its ranking order; 'date' maps to a newest-first capture-date
// sort (EXIF, falling back to file mtime — handled server-side).
const DATE_SORT = 'date:desc';

// Identity of a search run (query + mode + ordering). Used to de-dupe the
// URL-restore effect against searches we kicked off directly, so a shallow URL
// update never re-fires the same fetch.
const idKey = (q, sm, srt) => JSON.stringify([q, !!sm, srt]);

export default function Search() {
  const { loggedIn, isLoading: isPingLoading, features } = usePing({ redirect: '/' });

  const [input, setInput] = useState('');
  const [smart, setSmart] = useState(false);
  const [sort, setSort] = useState('relevance');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [index, setIndex] = useState(-1);
  const favorites = useFavoritesMulti(results);
  const searchParams = useSearchParams();

  // Mirror the loaded results + the active query so the paging callback (stable,
  // deps-less) can read the current offset and re-issue the same query for the
  // next page without going stale.
  const resultsRef = useRef([]);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);
  const activeRef = useRef({ q: '', sm: false, srt: 'relevance' });

  // The search identity (query/smart/sort) is written THROUGH the Next router
  // (shallow replace), not a raw history.replaceState. A bare replaceState
  // changes the address bar but leaves Next's tracked `as`/`url` at the plain
  // `/search`, so navigating away (e.g. "View on map") and pressing Back
  // restored `/search` WITHOUT the query — the results vanished (Gallery
  // Bugfix #1). Routing the identity keeps it in Next's history entry, so Back
  // lands on the populated search again.
  const syncQuery = useCallback((q, sm, srt) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (sm) params.set('smart', '1');
    if (srt === 'date') params.set('sort', 'date');
    const qs = params.toString();
    Router.replace(`/search${qs ? `?${qs}` : ''}`, undefined, { shallow: true });
  }, []);

  // The open-image marker stays a lightweight replaceState: it must not push
  // history or re-render the page as you arrow through the lightbox. But it also
  // patches Next's tracked entry (`url`/`as`) — not just the address bar — so a
  // Back navigation (e.g. off the map) restores the OPEN image, not only the
  // results. Next re-renders from `state.as` on popstate (see router.js), so
  // leaving `as` at the no-image URL is exactly why the lightbox didn't reopen.
  const syncImage = useCallback((image) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (image) url.searchParams.set('image', image);
    else url.searchParams.delete('image');
    const as = url.pathname + url.search;
    const prev = window.history.state || {};
    window.history.replaceState({ ...prev, url: as, as }, '', as);
  }, []);

  // A single page fetch. `append` distinguishes a fresh search (replace, from
  // offset 0) from paging in more (append, from the current result count).
  const doSearch = useCallback(async (q, sm, srt, { append = false } = {}) => {
    const query = q.trim();
    if (!query) return;
    const offset = append ? resultsRef.current.length : 0;
    if (!append) {
      activeRef.current = { q: query, sm, srt };
      setBusy(true);
    } else {
      setLoadingMore(true);
    }
    try {
      // Keyword mode (semanticRatio 0) filters to images whose text/tags/place
      // match. Smart mode adds CLIP semantics + a relevance threshold so it
      // matches what photos depict; both filter rather than just re-rank.
      const body = sm
        ? { query, semanticRatio: SMART_SEMANTIC_RATIO, rankingScoreThreshold: SMART_SCORE_THRESHOLD, limit: PAGE_SIZE, offset }
        : { query, semanticRatio: 0, limit: PAGE_SIZE, offset };
      // Date sort is opt-in; relevance sends no `sort` so the backend keeps its
      // ranking order.
      if (srt === 'date') body.sort = DATE_SORT;
      const r = await geoSearch(body);
      const raw = r.results || [];
      const hits = raw.filter((it) => imageRef(it));
      setResults((prev) => (append ? [...prev, ...hits] : hits));
      setTotal(typeof r.total === 'number' ? r.total : null);
      // A full page back means there may be more; a short page is the end.
      // (Decided on the raw page length, not the imageRef-filtered count, so a
      // page that's all videos/unreferenceable doesn't look like the end.)
      setHasMore(raw.length >= PAGE_SIZE);
    } catch (err) {
      if (!append) {
        setResults([]);
        setTotal(0);
      }
      setHasMore(false);
    } finally {
      setSearched(true);
      if (append) setLoadingMore(false);
      else setBusy(false);
    }
  }, []);

  const runSearch = (e) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    // Mark this identity as already-run so the URL-restore effect (which fires
    // when the shallow replace updates the query params) doesn't fetch it again.
    autoRanFor.current = idKey(q, smart, sort);
    syncQuery(q, smart, sort); // new search: drops any stale open-image
    doSearch(q, smart, sort);
  };

  // Switch ordering: re-run the active query under the new sort (paging resets
  // since it's a fresh, non-append fetch). No-ops until a search has run; the
  // choice still persists to state so the next search uses it.
  const changeSort = (srt) => {
    setSort(srt);
    const active = activeRef.current;
    if (!active.q) return;
    autoRanFor.current = idKey(active.q, active.sm, srt);
    syncQuery(active.q, active.sm, srt);
    doSearch(active.q, active.sm, srt);
  };

  // Infinite scroll: when the sentinel below the grid scrolls into view (with a
  // generous rootMargin so the next page is fetched before the user hits the
  // bottom), page in more. Guarded so it never stacks fetches or fires before a
  // search has run.
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !busy && !loadingMore) {
          const a = activeRef.current;
          doSearch(a.q, a.sm, a.srt, { append: true });
        }
      },
      { rootMargin: '600px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, busy, loadingMore, doSearch]);

  // Restore from the URL: re-run the saved query so the grid repopulates (the
  // open image is reopened by the effect below, once results land). Keyed on the
  // query VALUE, not a mount-only ref: useSearchParams is empty on the first
  // render (before the router parses the query string) and only populates on a
  // later render, so a mount guard would fire on the empty pass and never retry.
  const urlQ = searchParams.get('q') || '';
  const urlSmart = searchParams.get('smart') === '1';
  const urlSort = searchParams.get('sort') === 'date' ? 'date' : 'relevance';
  const autoRanFor = useRef(null);
  useEffect(() => {
    if (!urlQ) return;
    const key = idKey(urlQ, urlSmart, urlSort);
    if (autoRanFor.current === key) return;
    autoRanFor.current = key;
    setInput(urlQ);
    setSmart(urlSmart);
    setSort(urlSort);
    doSearch(urlQ, urlSmart, urlSort);
  }, [urlQ, urlSmart, urlSort, doSearch]);

  // Reopen the lightbox at ?image= once its result is present. One-shot (a ref,
  // not an `index` guard): useSearchParams doesn't react to our replaceState, so
  // depending on index would re-fire and reopen the image right after a close.
  const openedFromUrl = useRef(false);
  const wantImage = searchParams.get('image');
  useEffect(() => {
    if (openedFromUrl.current || !wantImage || !results.length) return;
    const i = results.findIndex((r) => r.path === wantImage);
    if (i >= 0) {
      openedFromUrl.current = true;
      setIndex(i);
    }
  }, [wantImage, results]);

  if (isPingLoading) return <></>;
  if (!loggedIn) return <>Redirecting...</>;

  const slides = results.map(docToSlide).filter(Boolean);

  return (
    <div>
      <main>
        {/* Container fluid cancels the negative margins on the Bootstrap Row
            below; without a container those margins poke past the body edge and
            cause a horizontal scroll. */}
        <Container fluid>
        <Breadcrumb>
          <Breadcrumb.Item linkAs={Link} href="/home">
            Home
          </Breadcrumb.Item>
          <Breadcrumb.Item active>Search</Breadcrumb.Item>
        </Breadcrumb>

        {!features.search ? (
          <p>Search is currently unavailable.</p>
        ) : (
          <>
            <Form onSubmit={runSearch} className="mb-3">
              <Row className="align-items-center g-2">
                <Col xs={12} sm={7} md={8}>
                  <Form.Control
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      smart
                        ? 'Describe what the photo shows…'
                        : 'Search all photos by text, tags, or place…'
                    }
                  />
                </Col>
                <Col xs="auto">
                  <Form.Check
                    type="switch"
                    id="smart-search"
                    label="Smart"
                    checked={smart}
                    onChange={(e) => setSmart(e.target.checked)}
                    title="Semantic search: match what photos depict, not just text/tags"
                  />
                </Col>
                <Col xs="auto">
                  <Form.Select
                    size="sm"
                    aria-label="Sort results"
                    value={sort}
                    onChange={(e) => changeSort(e.target.value)}
                    style={{ width: 'auto' }}
                    title="Order results by relevance or capture date (newest first)"
                  >
                    <option value="relevance">Relevance</option>
                    <option value="date">Newest</option>
                  </Form.Select>
                </Col>
                <Col xs="auto" className="ms-auto">
                  <Button type="submit" disabled={busy}>
                    {busy ? '…' : 'Search'}
                  </Button>
                </Col>
              </Row>
            </Form>

            {busy ? (
              <>Searching…</>
            ) : searched && results.length === 0 ? (
              <p>No matching photos.</p>
            ) : (
              <>
                {typeof total === 'number' && total > 0 && (
                  <div className="text-muted small mb-2">
                    {total > results.length
                      ? `Showing ${results.length} of ${total}`
                      : `${results.length} ${results.length === 1 ? 'photo' : 'photos'}`}
                  </div>
                )}
                {/* Deterministic square grid (like the album view): every
                    thumbnail is the same size and columns auto-fit the width, so
                    there's no justified-layout size jump and no overflow. */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: 2,
                  }}
                >
                  {results.map((r, i) => (
                    <img
                      key={r.path || i}
                      src={imageurl({ ...imageRef(r), thumb: THUMB })}
                      alt={r.path}
                      title={r.path}
                      loading="lazy"
                      onClick={() => setIndex(i)}
                      style={{
                        width: '100%',
                        aspectRatio: '1 / 1',
                        objectFit: 'cover',
                        display: 'block',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
                {/* Infinite-scroll sentinel + loading hint. */}
                <div ref={sentinelRef} />
                {loadingMore && (
                  <div className="text-muted small text-center my-2">
                    Loading more…
                  </div>
                )}
              </>
            )}

            <MetaLightbox
              slides={slides}
              plugins={[Video]}
              open={index >= 0}
              index={index}
              close={() => {
                setIndex(-1);
                syncImage(null);
              }}
              on={{
                view: ({ index: i }) => {
                  setIndex(i);
                  syncImage(results[i]?.path);
                },
              }}
              actions={(slide) => <ViewOnMapAction meta={slide.meta} />}
              favorite={{
                isFavorite: (slide) => favorites.isFavorite(slide.meta),
                onToggle: (slide, next) => favorites.toggle(slide.meta, next),
              }}
            />
          </>
        )}
        </Container>
      </main>
    </div>
  );
}
