// vim: tabstop=2 shiftwidth=2 expandtab
//
// The admin page's on-demand fetch state machine, extracted once. Several
// panels fetch a snapshot only when the user presses a button (never polled,
// so they add no background load and never race a running scan); each used to
// hand-roll the identical {data, busy, error} triplet and they had started to
// drift. Not SWR on purpose: these are explicit one-shot reads, not cached
// subscriptions.

import { useState, useCallback } from 'react'

export const useOnDemandFetch = (fn) => {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  const run = useCallback(async () => {
    setBusy(true)
    setError(false)
    try {
      const d = await fn()
      setData(d)
      return d
    } catch (err) {
      setError(true)
      return null
    } finally {
      setBusy(false)
    }
  }, [fn])

  // setError is exposed for actions that piggyback on a panel's error display
  // (e.g. clearing failed tasks reports into the coverage panel's error slot).
  return { data, busy, error, run, setError }
}
