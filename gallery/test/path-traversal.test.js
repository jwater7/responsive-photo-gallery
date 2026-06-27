// vim: tabstop=2 shiftwidth=2 expandtab
//
// Security proof: caller-supplied album / path inputs cannot escape their
// configured root directory. Specifically guards the sibling-prefix bug a naive
// `resolved.startsWith(root)` check is vulnerable to — e.g. root "/data/cache"
// would wrongly accept "/data/cache-evil". The hardened checks require a path
// separator at the boundary. Run: npm run test:unit

const os = require('os')
const fs = require('fs')
const path = require('path')

// --- hermetic environment (set BEFORE requiring the app modules) ------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-traversal-test-'))
const mk = (d) => {
  const p = path.join(tmp, d)
  fs.mkdirSync(p, { recursive: true })
  return p
}
delete process.env.NO_AUTHENTICATION
delete process.env.DEBUG
process.env.NODE_ENV = 'test'
process.env.AUTH_PATH = mk('auth')
process.env.IMAGE_PATH = mk('images')
process.env.TAGS_PATH = mk('tags')
process.env.CACHE_PATH = mk('cache')
process.env.DEFAULT_PASSWORD = 'test-password'
process.env.PRIVATE_KEY = 'test-private-signing-key-0123456789abcdef'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const createApp = require('../app')
const albumBuild = require('../handlers/album-build')

// --- 1. Pure containment primitive (safeJoin via albumCacheDir) -------------
test('albumCacheDir confines album names to CACHE_PATH', () => {
  const base = path.resolve(process.env.CACHE_PATH)

  // Legitimate album resolves inside the cache root.
  const ok = albumBuild.albumCacheDir('summer-2024')
  assert.equal(ok, path.join(base, 'summer-2024'))

  // Sibling-prefix escape: "../<base>-evil" resolves to "<base>-evil", which a
  // bare startsWith(base) would WRONGLY accept. The separator boundary rejects it.
  const sibling = '../' + path.basename(base) + '-evil'
  assert.equal(albumBuild.albumCacheDir(sibling), '')

  // Classic parent-dir traversal is rejected too.
  assert.equal(albumBuild.albumCacheDir('../../../etc'), '')
})

// --- 2. Route-level checks reject traversal (over HTTP, authenticated) -------
let server, base
const req = (p, cookie) => fetch(base + p, { headers: { cookie } })

async function authCookie() {
  const res = await fetch(base + '/api/v1/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-password' }),
  })
  assert.equal(res.status, 200)
  return res.headers
    .getSetCookie()
    .find((c) => c.startsWith('jwt='))
    .split(';')[0]
}

test.before(async () => {
  const app = await createApp()
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

test.after(() => {
  server && server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('GET /album-tags rejects a path-traversal album (400)', async () => {
  const cookie = await authCookie()
  const evil = encodeURIComponent('../../../../etc')
  const res = await req(`/api/v1/album-tags?album=${evil}`, cookie)
  assert.equal(res.status, 400)
})

test('GET /album-cover rejects a path-traversal album (400)', async () => {
  const cookie = await authCookie()
  const evil = encodeURIComponent('../../../../etc')
  const res = await req(`/api/v1/album-cover?album=${evil}`, cookie)
  assert.equal(res.status, 400)
})

test('GET /album-tags allows a normal album name (200)', async () => {
  const cookie = await authCookie()
  const res = await req('/api/v1/album-tags?album=summer-2024', cookie)
  assert.equal(res.status, 200) // no tag dir yet → empty list, still 200
})
