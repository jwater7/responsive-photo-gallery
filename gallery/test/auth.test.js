// vim: tabstop=2 shiftwidth=2 expandtab
//
// Security proof: every API endpoint under /api/v1/* requires authentication,
// except the deliberately-public login endpoint and the (documented) Swagger
// docs. Run: npm run test:auth
//
// Strategy: boot the real Express app against throwaway data dirs, then probe
// every route both unauthenticated (must be 401) and authenticated (must NOT be
// 401 — i.e. the auth gate let it through). The auth env MUST be set before the
// app modules are required, because routes/*.js read paths at require-time.

const os = require('os')
const fs = require('fs')
const path = require('path')

// --- hermetic environment (set BEFORE requiring the app) --------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-auth-test-'))
const mk = (d) => {
  const p = path.join(tmp, d)
  fs.mkdirSync(p, { recursive: true })
  return p
}
delete process.env.NO_AUTHENTICATION // never bypass the gate in this suite
delete process.env.DEBUG // keep CORS-in-debug off
process.env.NODE_ENV = 'test'
process.env.AUTH_PATH = mk('auth')
process.env.IMAGE_PATH = mk('images')
process.env.TAGS_PATH = mk('tags')
process.env.CACHE_PATH = mk('cache')
// Runtime-config (exclude list) store — keep the authed PUT /excludes probe
// off any real /data/config on the host.
process.env.CONFIG_PATH = mk('config')
process.env.DEFAULT_PASSWORD = 'test-password'
process.env.PRIVATE_KEY = 'test-private-signing-key-0123456789abcdef'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const createApp = require('../app')

// The set of routes is DERIVED from the live app at boot (see discoverRoutes)
// rather than hand-listed, so this suite can't silently drift behind
// routes/*.js: any new route under /api/v1 is automatically probed, and a
// route that ships without the auth gate fails the unauthenticated check.

// Routes that are *intentionally* reachable without auth. Everything else the
// app mounts under /api/v1 must reject anonymous access. Keep this list short
// and deliberate — adding to it is a conscious decision to expose a surface.
const PUBLIC = new Set([
  'POST /api/v1/login', // initial authentication
  'GET /api/v1/swagger.json', // KNOWN info disclosure (asserted separately)
])

// Walk the live Express 5 router tree and return "METHOD /full/path" strings
// for every route mounted under /api/v1 (gallery API + enrichment proxy).
// Express 5 dropped layer.regexp; the supported way to recover a sub-router's
// mount prefix is its matcher, which consumes and returns that prefix for any
// path beneath it. Both API mounts (/api/v1 and /api/v1/enrich) are prefixes
// of this deep probe, so each sub-router's matcher reports its own mount path.
function discoverRoutes(app) {
  const DEEP = '/api/v1/enrich/__probe__'
  const out = new Set()
  const add = (prefix, route) => {
    const full = prefix + route.path
    if (!full.startsWith('/api/v1')) return // ignore static/SPA/error layers
    for (const m of Object.keys(route.methods)) {
      if (!route.methods[m]) continue
      // router.all() registers as `_all`; expand to the verbs we care about.
      const verbs = m === '_all' ? ['GET', 'POST'] : [m.toUpperCase()]
      for (const v of verbs) out.add(`${v} ${full}`)
    }
  }
  for (const layer of (app.router || app._router).stack) {
    if (layer.route) {
      add('', layer.route) // direct app-level route (e.g. /api/v1/swagger.json)
    } else if (layer.handle && layer.handle.stack && layer.matchers) {
      const m = layer.matchers[0](DEEP)
      if (!m) continue // sub-router not under /api/v1
      for (const child of layer.handle.stack) {
        if (child.route) add(m.path, child.route)
      }
    }
  }
  return [...out]
}

let server, base
let ROUTES, PROTECTED

test.before(async () => {
  const app = await createApp()
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
  ROUTES = discoverRoutes(app)
  PROTECTED = ROUTES.filter((r) => !PUBLIC.has(r))
})

// Helpers to split a "METHOD /path" entry back into its parts.
const verb = (r) => r.split(' ')[0]
const route = (r) => r.split(' ')[1]

test.after(() => {
  server && server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const req = (method, p, { cookie, body } = {}) =>
  fetch(base + p, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie && { cookie }),
    },
    body: ['POST', 'PATCH', 'PUT'].includes(method)
      ? JSON.stringify(body || {})
      : undefined,
  })

// Log in as the seeded admin and return the signed `jwt` cookie to replay.
async function authCookie() {
  const res = await req('POST', '/api/v1/login', {
    body: { username: 'admin', password: 'test-password' },
  })
  assert.equal(res.status, 200, 'login should succeed with seeded creds')
  const jwt = res.headers.getSetCookie().find((c) => c.startsWith('jwt='))
  assert.ok(jwt, 'login must set a jwt cookie')
  return jwt.split(';')[0] // "jwt=s%3A....": name=value only
}

// --- 0. The discovery itself is sane (guards against introspection breaking
// and silently probing nothing). If this fails, the suite below is hollow. ---
test('route discovery finds the full /api/v1 surface', async () => {
  // Floor well below the real count (~24) but high enough to catch a broken
  // walk that returns just a handful.
  assert.ok(
    PROTECTED.length >= 18,
    `expected to discover the API surface, got only ${PROTECTED.length}: ${PROTECTED.join(', ')}`
  )
  // Sentinels across both routers, incl. admin routes the old static list
  // had drifted past — proves nested + mount-gated routes are covered.
  for (const r of [
    'GET /api/v1/excludes',
    'PUT /api/v1/excludes',
    'GET /api/v1/album-activity',
    'POST /api/v1/enrich/reap',
    'GET /api/v1/enrich/index-stats',
  ]) {
    assert.ok(ROUTES.includes(r), `discovery should include ${r}`)
  }
})

// --- 1. Unauthenticated access is rejected on EVERY protected route ---------
test('every protected route rejects anonymous access (401)', async (t) => {
  for (const r of PROTECTED) {
    await t.test(r, async () => {
      const res = await req(verb(r), route(r))
      assert.equal(
        res.status,
        401,
        `${r} must reject anonymous access with 401, got ${res.status}`
      )
    })
  }
})

// A forged/garbage cookie must also be rejected (signature + JWT verification).
test('401 with a forged jwt cookie', async () => {
  const res = await req('GET', '/api/v1/albums', {
    cookie: 'jwt=s%3Anot-a-real-token.deadbeef',
  })
  assert.equal(res.status, 401)
})

// --- 2. Authenticated access passes the gate (status is never 401) ----------
// We only assert the gate is cleared (not 401); the handler may still 4xx/5xx
// for missing fixtures — that still proves auth let the request through.
test('authenticated requests clear the auth gate', async () => {
  const cookie = await authCookie()
  for (const r of PROTECTED) {
    const [method, p] = [verb(r), route(r)]
    // skip the enrich proxy POSTs — they make a 15s upstream fetch when authed
    if (p.startsWith('/api/v1/enrich/') && method !== 'GET') continue
    const res = await req(method, p, { cookie })
    assert.notEqual(
      res.status,
      401,
      `${r} should NOT be 401 once authenticated, got ${res.status}`
    )
  }
})

test('ping returns the caller identity once authenticated', async () => {
  const cookie = await authCookie()
  const res = await req('GET', '/api/v1/ping', { cookie })
  assert.equal(res.status, 200)
})

// --- 3. Documented public surface ------------------------------------------
test('login is intentionally public (reachable without auth)', async () => {
  const res = await req('POST', '/api/v1/login', {
    body: { username: 'admin', password: 'wrong' },
  })
  // Reachable + rejects bad creds — NOT a 401 from the auth gate.
  assert.notEqual(res.status, 401)
  assert.equal(res.status, 403)
})

// KNOWN EXPOSURE (low severity): the Swagger spec + UI are served without auth.
// This test documents current behaviour so a future change to gate them is a
// deliberate, visible decision rather than a silent regression.
test('KNOWN: swagger.json is publicly accessible (info disclosure)', async () => {
  const res = await req('GET', '/api/v1/swagger.json')
  assert.equal(
    res.status,
    200,
    'documents that the API schema is unauthenticated'
  )
})
