// vim: tabstop=2 shiftwidth=2 expandtab
//
// Search page "Hide videos" toggle: opt-in flag → `excludeVideos` in the
// request body (default sends nothing, keeping existing behavior
// byte-identical), URL persistence via `videos=0` (restore on load re-runs the
// search with the flag), and immediate re-run when flipped on live results
// (changeSort semantics).

import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// ---- module mocks (hoisted by vitest above the imports below) --------------
vi.mock('next/router', () => ({
  default: { replace: vi.fn() },
}))

const searchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}))

vi.mock('../data/use-ping', () => ({
  usePing: () => ({ loggedIn: true, isLoading: false, features: { search: true } }),
}))

vi.mock('../data/use-favorites', () => ({
  useFavoritesMulti: () => ({ isFavorite: () => false, toggle: () => {} }),
}))

const geoSearch = vi.fn(async () => ({ results: [], total: 0 }))
vi.mock('../lib/enrich-api', () => ({
  geoSearch: (...args) => geoSearch(...args),
}))

// Lightbox chain pulls browser-only CSS/plugins — stub the leaves.
vi.mock('../components/MetaLightbox', () => ({ default: () => null }))
vi.mock('../components/ViewOnMapAction', () => ({ default: () => null }))
vi.mock('yet-another-react-lightbox/plugins/video', () => ({ default: {} }))
vi.mock('../lib/slide', () => ({ docToSlide: () => null }))

import Router from 'next/router'
import Search from '../pages/search'

afterEach(cleanup) // vitest runs without globals:true, so no auto-cleanup

beforeEach(() => {
  geoSearch.mockClear()
  Router.replace.mockClear()
  searchParams.forEach((_, k) => searchParams.delete(k))
  global.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  }
})

async function runSearch(query) {
  // getByRole, not placeholder text — the smart toggle swaps the placeholder.
  fireEvent.change(screen.getByRole('textbox'), { target: { value: query } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() => expect(geoSearch).toHaveBeenCalled())
}

test('default search sends no excludeVideos (behavior unchanged)', async () => {
  render(<Search />)
  await runSearch('beach')
  const body = geoSearch.mock.calls[0][0]
  expect(body.query).toBe('beach')
  expect('excludeVideos' in body).toBe(false)
})

test('smart mode sends smartCutoff, never an absolute rankingScoreThreshold', async () => {
  render(<Search />)
  fireEvent.click(screen.getByLabelText('Smart'))
  await runSearch('beach')
  const body = geoSearch.mock.calls[0][0]
  expect(body.smartCutoff).toBe(true)
  expect(body.semanticRatio).toBeGreaterThan(0)
  // The old absolute threshold can't act as a relevance filter on CLIP-style
  // scores (flat magnitude band) — the server-side relative trim replaced it.
  expect('rankingScoreThreshold' in body).toBe(false)
})

test('toggle on → excludeVideos sent and videos=0 persisted to the URL', async () => {
  render(<Search />)
  fireEvent.click(screen.getByLabelText('Hide videos'))
  await runSearch('beach')
  expect(geoSearch.mock.calls[0][0].excludeVideos).toBe(true)
  const url = Router.replace.mock.calls.at(-1)[0]
  expect(url).toContain('videos=0')
  expect(url).toContain('q=beach')
})

test('flipping the toggle on live results re-runs the search immediately', async () => {
  render(<Search />)
  await runSearch('beach')
  expect(geoSearch).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByLabelText('Hide videos'))
  await waitFor(() => expect(geoSearch).toHaveBeenCalledTimes(2))
  expect(geoSearch.mock.calls[1][0].excludeVideos).toBe(true)
  // ...and flipping it back off drops the flag again.
  fireEvent.click(screen.getByLabelText('Hide videos'))
  await waitFor(() => expect(geoSearch).toHaveBeenCalledTimes(3))
  expect('excludeVideos' in geoSearch.mock.calls[2][0]).toBe(false)
})

test('URL restore (videos=0) re-runs with the flag and checks the toggle', async () => {
  searchParams.set('q', 'beach')
  searchParams.set('videos', '0')
  render(<Search />)
  await waitFor(() => expect(geoSearch).toHaveBeenCalled())
  expect(geoSearch.mock.calls[0][0].excludeVideos).toBe(true)
  expect(screen.getByLabelText('Hide videos').checked).toBe(true)
})
