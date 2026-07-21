// vim: tabstop=2 shiftwidth=2 expandtab
//
// AlbumBuildsPanel rebuild action: album checkbox grid (universe loaded from
// /albums, ExcludesPanel-style), one rebuild per ticked album, success clears
// the selection, per-album failures are surfaced (not swallowed), and the
// button stays disabled with nothing ticked.

import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../lib/api', () => ({
  albums: vi.fn(async () => ({ 'test-videos': {}, vacation: {}, pets: {} })),
}))

import AlbumBuildsPanel from '../components/admin/AlbumBuildsPanel'

afterEach(cleanup) // vitest runs without globals:true, so no auto-cleanup

const idleActivity = { building: [], activeBuilds: 0, queuedBuilds: 0, concurrency: 2 }

async function renderPanel(onRebuild) {
  render(<AlbumBuildsPanel activity={idleActivity} onRebuild={onRebuild} loggedIn />)
  await screen.findByLabelText('pets') // album universe loaded
}

test('rebuilds each ticked album and clears the selection on success', async () => {
  const onRebuild = vi.fn(async () => ({ state: 'building' }))
  await renderPanel(onRebuild)

  fireEvent.click(screen.getByLabelText('test-videos'))
  fireEvent.click(screen.getByLabelText('pets'))
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild selected (2)' }))

  await waitFor(() => expect(onRebuild).toHaveBeenCalledTimes(2))
  expect(onRebuild).toHaveBeenCalledWith('pets')
  expect(onRebuild).toHaveBeenCalledWith('test-videos')
  expect(await screen.findByText(/Rebuilding 2 albums/)).toBeTruthy()
  expect(screen.getByLabelText('pets').checked).toBe(false) // selection cleared
})

test('a per-album failure is surfaced and keeps the selection', async () => {
  const onRebuild = vi.fn(async (name) => {
    if (name === 'vacation') throw new Error('No media in album')
    return { state: 'building' }
  })
  await renderPanel(onRebuild)

  fireEvent.click(screen.getByLabelText('vacation'))
  fireEvent.click(screen.getByLabelText('pets'))
  fireEvent.click(screen.getByRole('button', { name: /Rebuild selected/ }))

  expect(await screen.findByText(/Started 1 of 2 — vacation: No media in album/)).toBeTruthy()
  expect(screen.getByLabelText('vacation').checked).toBe(true) // kept for retry
})

test('button is disabled with nothing ticked', async () => {
  await renderPanel(vi.fn())
  expect(screen.getByRole('button', { name: 'Rebuild selected' }).disabled).toBe(true)
})
