// vim: tabstop=2 shiftwidth=2 expandtab
//
// CellPhotos page-0 double-fetch regression: the mount effect and the
// IntersectionObserver's initial callback both call loadMore from the same
// render, where the `loading` state closure is still false — without a
// synchronous re-entry guard both requests go out at offset 0 and both append,
// duplicating the grid (A B A B under a correct "2 photos here" header) and
// double-advancing the paging offset. The observer mock fires synchronously on
// observe() to force the losing side of the race deterministically.

import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'

const geoSearch = vi.fn()
vi.mock('../lib/enrich-api', () => ({
  geoSearch: (...args) => geoSearch(...args),
}))

vi.mock('../lib/api', () => ({
  imageurl: ({ album, image }) => `/img/${album}/${image}`,
}))

import CellPhotos from '../components/map/CellPhotos'
import { POPUP_PAGE_SIZE } from '../components/map/map-config'

const doc = (name) => ({ hash: name, album: 'a', path: `a/${name}.jpg` })

afterEach(cleanup)

beforeEach(() => {
  geoSearch.mockReset()
  // Worst-case timing: the initial intersection callback is delivered before
  // React flushes the loading-state re-render (real browsers sometimes do).
  global.IntersectionObserver = class {
    constructor(cb) {
      this.cb = cb
    }
    observe() {
      this.cb([{ isIntersecting: true }])
    }
    disconnect() {}
  }
})

const renderCell = (count, onFirstPage = () => {}) =>
  render(
    <CellPhotos
      resolution={8}
      cell="88283082b9fffff"
      count={count}
      excludeInferred
      onOpen={() => {}}
      onClose={() => {}}
      onFirstPage={onFirstPage}
    />
  )

test('small cell fetches page 0 exactly once — no duplicated thumbnails', async () => {
  geoSearch.mockResolvedValue({ results: [doc('A'), doc('B')] })
  renderCell(2)
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
  expect(geoSearch).toHaveBeenCalledTimes(1)
  expect(geoSearch.mock.calls[0][0].offset).toBe(0)
})

test('paging offset stays intact: page 1 asks for offset PAGE_SIZE', async () => {
  const page0 = Array.from({ length: POPUP_PAGE_SIZE }, (_, i) => doc(`p0-${i}`))
  geoSearch.mockResolvedValueOnce({ results: page0 }).mockResolvedValueOnce({ results: [doc('last')] })
  renderCell(POPUP_PAGE_SIZE + 1)
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(POPUP_PAGE_SIZE + 1))
  expect(geoSearch).toHaveBeenCalledTimes(2)
  expect(geoSearch.mock.calls[0][0].offset).toBe(0)
  // A doubled page-0 fetch would have advanced this to 2 * PAGE_SIZE, silently
  // skipping the second page for any cell larger than one page.
  expect(geoSearch.mock.calls[1][0].offset).toBe(POPUP_PAGE_SIZE)
})

// The popup opens (and Leaflet auto-pans) around the small "Loading…" box; the
// async first page then grows it inside a React portal Leaflet can't see, so
// MapView must be told to popup.update() (re-measure + auto-pan) — once, or
// later pages would yank the map while the user scrolls the list.
test('onFirstPage fires exactly once, after the grid is in the DOM', async () => {
  const onFirstPage = vi.fn(() => {
    // Called from a layout effect AFTER the thumbs render, so the popup
    // re-measure sees the grown grid, not the "Loading…" box.
    expect(screen.getAllByRole('img')).toHaveLength(POPUP_PAGE_SIZE)
  })
  const page0 = Array.from({ length: POPUP_PAGE_SIZE }, (_, i) => doc(`p0-${i}`))
  geoSearch.mockResolvedValueOnce({ results: page0 }).mockResolvedValueOnce({ results: [doc('last')] })
  renderCell(POPUP_PAGE_SIZE + 1, onFirstPage)
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(POPUP_PAGE_SIZE + 1))
  expect(onFirstPage).toHaveBeenCalledTimes(1)
})
