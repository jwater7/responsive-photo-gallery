import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { Breadcrumb, Button, ButtonGroup, Form, ProgressBar } from 'react-bootstrap'
import { useSearchParams } from 'next/navigation'
import Video from 'yet-another-react-lightbox/plugins/video'
import Slideshow from 'yet-another-react-lightbox/plugins/slideshow'

import { usePing } from '../data/use-ping'
import { useAlbum } from '../data/use-album'
import { useFavorites } from '../data/use-favorites'

import { imageurl as apiImageurl, videourl as apiVideourl } from '../lib/api'
import { geoSearch } from '../lib/enrich-api'
import MetaLightbox from '../components/MetaLightbox'
import ViewOnMapAction from '../components/ViewOnMapAction'
import SpriteGrid from '../components/SpriteGrid'

// Flatten the manifest into render groups (for the grid + skip-to-month) and one
// global ordered list (the lightbox pages this; the index is the cell's position).
function flattenManifest(manifest) {
  if (!manifest) return { groups: [], ordered: [] }
  const sheetByN = new Map(manifest.sheets.map((s) => [s.n, s]))
  const ordered = []
  const groups = manifest.groups.map((g) => {
    const cells = []
    for (const n of g.sheets) {
      const sheet = sheetByN.get(n)
      if (!sheet) continue
      for (const cell of sheet.cells) {
        const entry = { ...cell, sheet, globalIndex: ordered.length, group: g.key }
        ordered.push(entry)
        cells.push(entry)
      }
    }
    return { key: g.key, label: g.label, count: g.count, cells }
  })
  return { groups, ordered }
}

export default function Album() {
  const { loggedIn, isLoading: isPingLoading, features } = usePing({ redirect: '/' })
  const searchParams = useSearchParams()
  const album = searchParams.get('album')

  const { manifest, building, status } = useAlbum(album)
  const { favSet, toggle: toggleFavorite } = useFavorites(album)

  const [index, setIndex] = useState(-1)
  const [columns, setColumns] = useState(6)
  const [enrichMap, setEnrichMap] = useState({})
  const groupRefs = useRef({})

  // Mobile-first default column count, set after mount (window not available SSR).
  useEffect(() => {
    setColumns(typeof window !== 'undefined' && window.innerWidth < 640 ? 3 : 6)
  }, [])

  const { groups, ordered } = useMemo(() => flattenManifest(manifest), [manifest])

  // Enrichment overlay (AI tags, geo, OCR…) keyed by full path. Fail-soft and
  // only when the enrichment feature is up, so the album works when it is down.
  useEffect(() => {
    if (!album || !features.search) {
      setEnrichMap({})
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const safe = album.replace(/"/g, '\\"')
        const r = await geoSearch({ filter: `album = "${safe}"`, limit: 1000 })
        if (cancelled) return
        const map = {}
        for (const doc of r.results || []) map[doc.path] = doc
        setEnrichMap(map)
      } catch (_) {
        if (!cancelled) setEnrichMap({})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [album, features.search])

  // Deep-link: open the lightbox at ?image= once the manifest is loaded.
  const wantImage = searchParams.get('image')
  useEffect(() => {
    if (!ordered.length || !wantImage) return
    const i = ordered.findIndex((e) => e.image === wantImage)
    if (i >= 0) setIndex(i)
  }, [wantImage, ordered])

  // Reflect the viewed image in the URL (shareable / back-button) without a
  // router navigation (replaceState avoids re-triggering the deep-link effect).
  // Patch Next's tracked entry (`url`/`as`), not just the address bar: Next
  // re-renders from `state.as` on popstate, so leaving `as` at the no-image URL
  // is why Back off the map landed on the album WITHOUT reopening the lightbox
  // (the search view fixed the same bug in syncImage). Spread the existing state
  // so Next's routing metadata (`__N`) is preserved — wiping it would strand the
  // back button on the other page.
  const setDeepLink = useCallback((image) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (image) url.searchParams.set('image', image)
    else url.searchParams.delete('image')
    const as = url.pathname + url.search
    const prev = window.history.state || {}
    window.history.replaceState({ ...prev, url: as, as }, '', as)
  }, [])

  const registerGroupRef = (key) => (el) => {
    groupRefs.current[key] = el
  }
  const jumpTo = (key) => {
    if (key === '__top') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    groupRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (isPingLoading || !album) return <></>
  if (!loggedIn) return <>Redirecting...</>

  const slides = ordered.map((e) => {
    const enrich = enrichMap[`${album}/${e.image}`]
    return {
      ...(e.format === 'video'
        ? {
            type: 'video',
            poster: apiImageurl({ album, image: e.image, thumb: '256x256' }),
            preload: 'auto',
            sources: [
              { src: apiVideourl({ album, image: e.image }), type: 'video/mp4' },
            ],
            download: apiVideourl({ album, image: e.image }),
          }
        : { src: apiImageurl({ album, image: e.image }) }),
      title: e.image,
      width: e.orientedWidth,
      height: e.orientedHeight,
      meta: {
        ...(enrich || {}),
        path: e.image,
        mime_type: e.format === 'video' ? 'video' : enrich?.mime_type,
        favorite: favSet.has(e.image),
      },
    }
  })

  // "Favorites" pseudo-group at the top: the favorited images, reusing their
  // sprite cells (and global index, so the lightbox opens the right slide).
  // Recomputed from favSet, so it updates live when a favorite is toggled.
  const favoriteCells = ordered.filter((e) => favSet.has(e.image))
  const displayGroups = favoriteCells.length
    ? [
        {
          key: 'favorites',
          label: 'Favorites',
          count: favoriteCells.length,
          cells: favoriteCells,
        },
        ...groups,
      ]
    : groups

  return (
    <div>
      <main>
        <Breadcrumb>
          <Breadcrumb.Item linkAs={Link} href="/home">
            Home
          </Breadcrumb.Item>
          <Breadcrumb.Item active>Album</Breadcrumb.Item>
        </Breadcrumb>
        <h4 style={{ overflow: 'hidden' }}>{album}</h4>

        {building && (
          <div style={{ margin: '12px 0' }}>
            <div style={{ marginBottom: 6 }}>
              Building album… {status?.done ?? 0} / {status?.total ?? '?'}
            </div>
            <ProgressBar
              animated
              now={
                status?.total ? Math.round((status.done / status.total) * 100) : 0
              }
            />
          </div>
        )}

        {!manifest && !building && <>Loading…</>}

        {manifest && (
          <>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 6,
                position: 'sticky',
                top: 0,
                zIndex: 5,
                padding: '6px 0',
                background: 'var(--bs-body-bg, #fff)',
              }}
            >
              <Form.Select
                size="sm"
                value=""
                aria-label="Jump to section"
                style={{ width: 'auto', maxWidth: '70%' }}
                onChange={(e) => {
                  if (e.target.value) jumpTo(e.target.value)
                }}
              >
                <option value="" disabled hidden>
                  Jump to…
                </option>
                <option value="__top">↑ Top</option>
                {displayGroups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </Form.Select>
              <ButtonGroup size="sm" style={{ marginLeft: 'auto' }}>
                <Button
                  variant="outline-secondary"
                  aria-label="Zoom out (more per row)"
                  onClick={() => setColumns((c) => Math.min(c + 1, 12))}
                >
                  −
                </Button>
                <Button
                  variant="outline-secondary"
                  aria-label="Zoom in (fewer per row)"
                  onClick={() => setColumns((c) => Math.max(c - 1, 1))}
                >
                  +
                </Button>
              </ButtonGroup>
            </div>

            <SpriteGrid
              album={album}
              groups={displayGroups}
              columns={columns}
              onSelect={(i) => {
                setIndex(i)
                setDeepLink(ordered[i]?.image)
              }}
              registerGroupRef={registerGroupRef}
              onPinch={setColumns}
            />

            <MetaLightbox
              slides={slides}
              open={index >= 0}
              index={index < 0 ? 0 : index}
              close={() => {
                setIndex(-1)
                setDeepLink(null)
              }}
              on={{
                view: ({ index: i }) => {
                  setIndex(i)
                  setDeepLink(ordered[i]?.image)
                },
              }}
              plugins={[Video, Slideshow]}
              extraButtons={['slideshow']}
              actions={(slide) => <ViewOnMapAction meta={slide.meta} />}
              controller={{ closeOnPullDown: true }}
              favorite={{
                isFavorite: (slide) => !!slide.meta?.favorite,
                onToggle: async (slide, next) =>
                  toggleFavorite(slide.meta.path, next),
              }}
            />
          </>
        )}
      </main>
    </div>
  )
}
