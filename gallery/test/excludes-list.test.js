// vim: tabstop=2 shiftwidth=2 expandtab
//
// Admin excludes are honored by GET /list and GET /thumbnails (the BREAKING
// behavioral fix of the walker consolidation): files under an excluded subtree
// are absent from both responses. Previously the image handler's private
// walker ignored the exclude list, so excluded subtrees stayed reachable here
// while albums, search, and enrichment all hid them. Boots the real app over
// HTTP (authenticated), same harness as list-params.test.js.
// Run: npm run test:unit  (from gallery/)

const os = require('os')
const fs = require('fs')
const path = require('path')

// --- hermetic environment (set BEFORE requiring the app modules) ------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-excludes-list-'))
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

// Nested exclude: hides album1/private without hiding album1 itself.
fs.writeFileSync(
  path.join(process.env.CONFIG_PATH, 'excludes.json'),
  JSON.stringify({ excludes: ['album1/private'] })
)

// Fixture: real 1x1 PNGs so /thumbnails can actually render them.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
for (const rel of ['album1/visible.png', 'album1/private/secret.png']) {
  const abs = path.join(process.env.IMAGE_PATH, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, PNG_1PX)
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

test('GET /list omits files under an excluded subtree', async () => {
  const cookie = await authCookie()
  const res = await req('/api/v1/list?album=album1', cookie)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(Object.keys(body.result), ['visible.png'])
})

test('GET /thumbnails omits files under an excluded subtree', async () => {
  const cookie = await authCookie()
  const res = await req('/api/v1/thumbnails?album=album1&thumb=8x8', cookie)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(Object.keys(body.result), ['visible.png'])
})
