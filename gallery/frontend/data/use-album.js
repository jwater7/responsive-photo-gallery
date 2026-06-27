import { useState, useEffect } from 'react'

import { albumManifest } from '../lib/api'

// Build pipeline. A slot is held for an album from its first request until its
// build is READY — not freed the instant the fast 202 returns. So at most
// PIPELINE_CONCURRENCY albums are ever in flight (being built + polled); the next
// album doesn't request/trigger/poll anything until one ahead of it finishes.
// This is what stops a whole-library cold load from putting every album into
// "building" and polling them all at once. Warm (already-built) albums return a
// manifest on the first request, so they pass through their slot instantly.
const PIPELINE_CONCURRENCY = 4
const POLL_MS = 2500
const MAX_ERRORS = 5
const withJitter = (ms) => ms + Math.floor(Math.random() * 1000)

let active = 0
const waiters = []
const acquireSlot = () => {
  if (active < PIPELINE_CONCURRENCY) {
    active++
    return Promise.resolve()
  }
  return new Promise((resolve) => waiters.push(resolve))
}
const releaseSlot = () => {
  const next = waiters.shift()
  if (next) next() // hand the slot straight to the next waiter (active unchanged)
  else active--
}

// Fetch an album's sprite manifest, holding a pipeline slot until the build is
// ready. While the API returns 202 (cold/stale build in progress) we re-poll the
// same endpoint (it carries build progress) on a gentle interval.
export const useAlbum = (album) => {
  const [manifest, setManifest] = useState(null)
  const [status, setStatus] = useState(null)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setManifest(null)
    setStatus(null)
    setBuilding(false)
    setError(null)
    if (!album) return

    let cancelled = false
    let timer = null
    let slotHeld = false
    const wait = (ms) =>
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms)
      })

    const run = async () => {
      await acquireSlot()
      if (cancelled) {
        releaseSlot()
        return
      }
      slotHeld = true
      setBuilding(true)
      let errors = 0
      try {
        while (!cancelled) {
          let res
          try {
            res = await albumManifest(album)
            errors = 0
          } catch (err) {
            if (cancelled) break
            if (++errors >= MAX_ERRORS) {
              setError(err)
              break
            }
            await wait(withJitter(POLL_MS))
            continue
          }
          if (cancelled) break
          if (res.manifest) {
            setManifest(res.manifest)
            setBuilding(false)
            break
          }
          // Still building — surface progress, then re-poll after a gentle wait.
          if (res.status) setStatus(res.status)
          await wait(withJitter(POLL_MS))
        }
      } finally {
        if (slotHeld) releaseSlot()
      }
    }
    run()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [album])

  return { manifest, building, status, error }
}
