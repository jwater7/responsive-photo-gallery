// vim: tabstop=2 shiftwidth=2 expandtab
//
// lib/api-base: the single prefix derivation (the reverse-proxy/base-path
// matrix that used to exist twice and could drift) and the shared fetch
// wrapper's error semantics. The env-driven prefixes are computed at module
// load, so each derivation case resets the module registry and re-imports.

import { describe, test, expect, vi, afterEach } from 'vitest'

const importFresh = async (env = {}) => {
  vi.resetModules()
  for (const name of [
    'PUBLIC_URL',
    'NEXT_PUBLIC_BASENAME',
    'NEXT_PUBLIC_API_PREFIX',
    'NEXT_PUBLIC_API_PREFIX_OVERRIDE',
  ]) {
    vi.stubEnv(name, env[name] ?? '')
    if (!(name in env)) delete process.env[name]
  }
  return import('../lib/api-base')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('prefix derivation', () => {
  test('defaults: root base path', async () => {
    const m = await importFresh()
    expect(m.BASE_PREFIX).toBe('/')
    expect(m.API_PREFIX).toBe('/api/v1')
    expect(m.ENRICH_PREFIX).toBe('/api/v1/enrich')
  })

  test('PUBLIC_URL sets the base (slash-normalized)', async () => {
    const m = await importFresh({ PUBLIC_URL: '/photos' })
    expect(m.BASE_PREFIX).toBe('/photos/')
    expect(m.API_PREFIX).toBe('/photos/api/v1')
  })

  test('NEXT_PUBLIC_BASENAME wins over PUBLIC_URL', async () => {
    const m = await importFresh({
      PUBLIC_URL: '/photos',
      NEXT_PUBLIC_BASENAME: '/gallery/',
    })
    expect(m.BASE_PREFIX).toBe('/gallery/')
    expect(m.API_PREFIX).toBe('/gallery/api/v1')
  })

  test('NEXT_PUBLIC_API_PREFIX splits the API from the base', async () => {
    const m = await importFresh({
      PUBLIC_URL: '/photos',
      NEXT_PUBLIC_API_PREFIX: 'http://localhost:8000',
    })
    expect(m.BASE_PREFIX).toBe('/photos/') // cookie path stays on the base
    expect(m.API_PREFIX).toBe('http://localhost:8000/api/v1')
    expect(m.ENRICH_PREFIX).toBe('http://localhost:8000/api/v1/enrich')
  })

  test('NEXT_PUBLIC_API_PREFIX_OVERRIDE wins (the dev-proxy setup)', async () => {
    // Mirrors the frontend dev script: API_PREFIX points at the API origin,
    // OVERRIDE routes through the dev proxy path instead.
    const m = await importFresh({
      NEXT_PUBLIC_API_PREFIX: 'http://localhost:8000/',
      NEXT_PUBLIC_API_PREFIX_OVERRIDE: '/api/',
    })
    expect(m.API_PREFIX).toBe('/api/api/v1')
  })
})

describe('qs', () => {
  test('encodes values, omits undefined/null, keeps empty string', async () => {
    const { qs } = await importFresh()
    expect(qs({ album: 'summer trip', image: 'a&b.jpg' })).toBe(
      'album=summer%20trip&image=a%26b.jpg'
    )
    expect(qs({ a: '1', b: undefined, c: null, d: '' })).toBe('a=1&d=')
  })
})

describe('apiFetch / apiRequest', () => {
  const jsonResponse = (status, body) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (body === undefined) throw new Error('no body')
      return body
    },
  })

  test('success returns the parsed body and sends JSON for object bodies', async () => {
    const { apiFetch } = await importFresh()
    const fetchMock = vi.fn(async () => jsonResponse(200, { result: 42 }))
    vi.stubGlobal('fetch', fetchMock)
    const json = await apiFetch('/x', { method: 'POST', body: { a: 1 } })
    expect(json).toEqual({ result: 42 })
    expect(fetchMock).toHaveBeenCalledWith('/x', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ a: 1 }),
    })
  })

  test('GET sends no headers/body', async () => {
    const { apiFetch } = await importFresh()
    const fetchMock = vi.fn(async () => jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/x')
    expect(fetchMock).toHaveBeenCalledWith('/x', { method: 'GET' })
  })

  test('non-ok with a server error body throws the server message', async () => {
    const { apiFetch } = await importFresh()
    vi.stubGlobal('fetch', async () =>
      jsonResponse(400, { error: { code: 400, message: 'user exists' } })
    )
    await expect(apiFetch('/x', {}, 'could not create user')).rejects.toThrow(
      'user exists'
    )
  })

  test('non-ok without a body falls back to the caller message + status', async () => {
    const { apiFetch } = await importFresh()
    vi.stubGlobal('fetch', async () => jsonResponse(502, undefined))
    await expect(apiFetch('/x', {}, 'search failed')).rejects.toThrow(
      'search failed (HTTP 502)'
    )
  })

  test('a 200 carrying an {error} body still throws', async () => {
    const { apiFetch } = await importFresh()
    vi.stubGlobal('fetch', async () =>
      jsonResponse(200, { error: { code: 500, message: 'broken' } })
    )
    await expect(apiFetch('/x')).rejects.toThrow('broken')
  })

  test('network failure throws with the cause attached', async () => {
    const { apiFetch } = await importFresh()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(apiFetch('/x')).rejects.toThrow('Failed to fetch')
  })

  test('apiRequest exposes raw status for callers that interpret it', async () => {
    const { apiRequest } = await importFresh()
    vi.stubGlobal('fetch', async () => jsonResponse(202, { result: { building: true } }))
    const { status, ok, json } = await apiRequest('/x')
    expect(status).toBe(202)
    expect(ok).toBe(true)
    expect(json).toEqual({ result: { building: true } })
  })
})
