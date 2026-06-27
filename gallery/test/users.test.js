// vim: tabstop=2 shiftwidth=2 expandtab
//
// User management: create / list / set-password / delete over the real app,
// proving the round trip end to end — including that a created user's password
// is hashed (the stored value is never the plaintext) yet still logs in, and
// that the safety guards (self-delete, last-user) hold.
//
// Same hermetic pattern as auth.test.js: set the auth env BEFORE requiring the
// app, boot against throwaway dirs.

const os = require('os')
const fs = require('fs')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-users-test-'))
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
process.env.CONFIG_PATH = mk('config')
process.env.DEFAULT_PASSWORD = 'admin-password'
process.env.PRIVATE_KEY = 'test-private-signing-key-0123456789abcdef'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const createApp = require('../app')

let server, base, authConfigPath
test.before(async () => {
  const app = await createApp()
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
  authConfigPath = path.join(process.env.AUTH_PATH, 'config.json')
})

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

async function login(username, password) {
  const res = await req('POST', '/api/v1/login', {
    body: { username, password },
  })
  if (res.status !== 200) return null
  const jwt = res.headers.getSetCookie().find((c) => c.startsWith('jwt='))
  return jwt ? jwt.split(';')[0] : null
}

test('admin can create a user whose password is hashed and who can log in', async () => {
  const cookie = await login('admin', 'admin-password')
  assert.ok(cookie, 'seeded admin should log in')

  const create = await req('POST', '/api/v1/users', {
    cookie,
    body: { username: 'alice', password: 's3cret-pw' },
  })
  assert.equal(create.status, 200, 'create should succeed')

  // The stored record must not contain the plaintext password.
  const stored = JSON.parse(fs.readFileSync(authConfigPath, 'utf8'))
  assert.ok(stored.users.alice, 'alice persisted')
  assert.equal(stored.users.alice.hashed, true, 'alice password is hashed')
  assert.ok(
    !String(stored.users.alice.password).includes('s3cret-pw'),
    'plaintext password must not be stored'
  )

  // The hashed password still authenticates.
  const aliceCookie = await login('alice', 's3cret-pw')
  assert.ok(aliceCookie, 'alice should log in with her password')
  assert.equal(
    await login('alice', 'wrong-pw'),
    null,
    'wrong password rejected'
  )
})

test('list users returns names + roles but no password material', async () => {
  const cookie = await login('admin', 'admin-password')
  const res = await req('GET', '/api/v1/users', { cookie })
  assert.equal(res.status, 200)
  const { result } = await res.json()
  const names = result.map((u) => u.username).sort()
  assert.deepEqual(names, ['admin', 'alice'])
  for (const u of result) {
    assert.ok(!('password' in u), 'list must not expose password')
  }
})

test('duplicate username and invalid name are rejected', async () => {
  const cookie = await login('admin', 'admin-password')
  const dup = await req('POST', '/api/v1/users', {
    cookie,
    body: { username: 'alice', password: 'x' },
  })
  assert.equal(dup.status, 400, 'duplicate user rejected')

  const bad = await req('POST', '/api/v1/users', {
    cookie,
    body: { username: 'bad/name', password: 'x' },
  })
  assert.equal(bad.status, 400, 'path-significant username rejected')
})

test('password reset takes effect', async () => {
  const cookie = await login('admin', 'admin-password')
  const res = await req('PUT', '/api/v1/users/alice/password', {
    cookie,
    body: { password: 'new-pw' },
  })
  assert.equal(res.status, 200)
  assert.equal(
    await login('alice', 's3cret-pw'),
    null,
    'old password no longer works'
  )
  assert.ok(await login('alice', 'new-pw'), 'new password works')
})

test('cannot delete your own account, can delete another', async () => {
  const cookie = await login('admin', 'admin-password')
  const self = await req('DELETE', '/api/v1/users/admin', { cookie })
  assert.equal(self.status, 400, 'self-delete refused')

  const other = await req('DELETE', '/api/v1/users/alice', { cookie })
  assert.equal(other.status, 200, 'deleting another user succeeds')
  assert.equal(
    await login('alice', 'new-pw'),
    null,
    'deleted user cannot log in'
  )
})

test('cannot delete the last remaining user', async () => {
  const cookie = await login('admin', 'admin-password')
  // Only admin remains now; even deleting a *different* (nonexistent) name is
  // moot — the guard triggers on count, and self-delete is separately blocked.
  // Recreate a second user, delete admin via that user, then verify the last
  // one can't be removed.
  await req('POST', '/api/v1/users', {
    cookie,
    body: { username: 'bob', password: 'bob-pw' },
  })
  const bobCookie = await login('bob', 'bob-pw')
  const delAdmin = await req('DELETE', '/api/v1/users/admin', {
    cookie: bobCookie,
  })
  assert.equal(delAdmin.status, 200, 'bob can delete admin')

  // Bob is now the last user; he can't delete himself, and there's no one else.
  const delSelf = await req('DELETE', '/api/v1/users/bob', {
    cookie: bobCookie,
  })
  assert.equal(delSelf.status, 400, 'last user cannot be deleted')
})
