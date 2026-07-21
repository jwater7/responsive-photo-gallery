// vim: tabstop=2 shiftwidth=2 expandtab
//
// data/use-on-demand-fetch: the admin panels' one-shot fetch state machine.
// Pins the {data, busy, error} contract the three previously hand-rolled
// copies had drifted on: busy only during flight, error cleared on a new run,
// failures keep the previous data, and run() resolves to the data (null on
// failure) so callers can chain.

import { test, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useOnDemandFetch } from '../data/use-on-demand-fetch'

test('success: run() sets data, resolves to it, and clears busy', async () => {
  const { result } = renderHook(() => useOnDemandFetch(async () => ({ n: 1 })))
  expect(result.current.data).toBe(null)
  expect(result.current.busy).toBe(false)

  let returned
  await act(async () => {
    returned = await result.current.run()
  })
  expect(returned).toEqual({ n: 1 })
  expect(result.current.data).toEqual({ n: 1 })
  expect(result.current.busy).toBe(false)
  expect(result.current.error).toBe(false)
})

test('busy is true while the fetch is in flight', async () => {
  let release
  const gate = new Promise((r) => (release = r))
  const { result } = renderHook(() => useOnDemandFetch(() => gate))

  let pending
  act(() => {
    pending = result.current.run()
  })
  await waitFor(() => expect(result.current.busy).toBe(true))

  await act(async () => {
    release({ ok: true })
    await pending
  })
  expect(result.current.busy).toBe(false)
  expect(result.current.data).toEqual({ ok: true })
})

test('failure: sets error, resolves null, keeps the previous data', async () => {
  let fail = false
  const { result } = renderHook(() =>
    useOnDemandFetch(async () => {
      if (fail) throw new Error('unreachable')
      return { n: 1 }
    })
  )
  await act(async () => {
    await result.current.run()
  })

  fail = true
  let returned
  await act(async () => {
    returned = await result.current.run()
  })
  expect(returned).toBe(null)
  expect(result.current.error).toBe(true)
  expect(result.current.data).toEqual({ n: 1 }) // stale snapshot retained
  expect(result.current.busy).toBe(false)

  // A later successful run clears the error again.
  fail = false
  await act(async () => {
    await result.current.run()
  })
  expect(result.current.error).toBe(false)
})

test('setError lets piggybacking actions report into the same slot', async () => {
  const { result } = renderHook(() => useOnDemandFetch(async () => ({})))
  act(() => {
    result.current.setError(true)
  })
  expect(result.current.error).toBe(true)
})
