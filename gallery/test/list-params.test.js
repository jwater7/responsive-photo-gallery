// vim: tabstop=2 shiftwidth=2 expandtab
//
// GET /list, /image, /video, /album-cover parameter handling — kept as public
// API surface (they have no in-repo caller, but stay documented/working by
// decision). Regressions guarded here:
//   - /list withMetadata with 2+ tags crashed: the async tag reducer spread
//     its promise accumulator ("acc is not iterable" → 500) instead of
//     awaiting it.
//   - invalid num_results silently limited to [] and surfaced as a misleading
//     500 "No Images Processed" instead of a 400.
//   - a missing image/album query param reached path.join/path.normalize with
//     undefined and threw (500) instead of a clean 400.
// Boots the real app over HTTP (authenticated), same harness as
// path-traversal.test.js. Run: npm run test:unit  (from gallery/)

const os = require('os')
const fs = require('fs')
const path = require('path')

// --- hermetic environment (set BEFORE requiring the app modules) ------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-list-params-test-'))
const mk = (d) => {
  const p = path.join(tmp, d)
  fs.mkdirSync(p, { recursive: true })
  return p
}
delete process.env.NO_AUTHENTICATION
delete process.env.DEBUG
process.env.NODE_ENV = 'test'
process.env.AUTH_PATH = mk('auth')
process.env.CONFIG_PATH = mk('config')
process.env.IMAGE_PATH = mk('images')
process.env.TAGS_PATH = mk('tags')
process.env.CACHE_PATH = mk('cache')
process.env.DEFAULT_PASSWORD = 'test-password'
process.env.PRIVATE_KEY = 'test-private-signing-key-0123456789abcdef'

// Fixture: one album with one real (1x1 PNG) image carrying two tags. Two tags
// matter: the reducer bug only fired from the second iteration on.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
fs.mkdirSync(path.join(process.env.IMAGE_PATH, 'album1'), { recursive: true })
fs.writeFileSync(path.join(process.env.IMAGE_PATH, 'album1', 'x.png'), PNG_1PX)
for (const tag of ['favorite', 'starred']) {
  const dir = path.join(process.env.TAGS_PATH, 'album1', tag)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'x.png'), '') // stat-able marker is enough
}

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const createApp = require('../app')

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

test('GET /list withMetadata resolves 2+ tags (async-reducer regression)', async () => {
  const cookie = await authCookie()
  const withMeta = encodeURIComponent(
    JSON.stringify({ tags: ['favorite', 'starred'] })
  )
  const res = await req(
    `/api/v1/list?album=album1&withMetadata=${withMeta}`,
    cookie
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body.result['x.png'].tags, ['favorite', 'starred'])
})

test('GET /list with a non-integer num_results → 400 (was a misleading 500)', async () => {
  const cookie = await authCookie()
  for (const bad of ['all', '2.5', '0', '-3']) {
    const res = await req(
      `/api/v1/list?album=album1&num_results=${bad}`,
      cookie
    )
    assert.equal(res.status, 400, `num_results=${bad} must be a 400`)
  }
})

test('GET /list with a valid num_results still limits', async () => {
  const cookie = await authCookie()
  const res = await req('/api/v1/list?album=album1&num_results=1', cookie)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(Object.keys(body.result).length, 1)
})

test('GET /image and /video without the image param → 400 (was a TypeError 500)', async () => {
  const cookie = await authCookie()
  for (const p of [
    '/api/v1/image?album=album1',
    '/api/v1/video?album=album1',
  ]) {
    const res = await req(p, cookie)
    assert.equal(res.status, 400, `${p} must be a 400`)
  }
})

test('album cache routes without the album param → 400 (safeJoin no longer throws)', async () => {
  const cookie = await authCookie()
  for (const p of [
    '/api/v1/album-cover',
    '/api/v1/album-manifest',
    '/api/v1/album-sprite?sheet=x.jpg',
  ]) {
    const res = await req(p, cookie)
    assert.equal(res.status, 400, `${p} must be a 400`)
  }
})
