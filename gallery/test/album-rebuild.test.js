// vim: tabstop=2 shiftwidth=2 expandtab
//
// rebuildAlbum: the admin recovery for a stale cached manifest. The quickKey
// fingerprint tracks the album's FILES, not the build code, so a manifest
// produced by older code (e.g. pre-registry builds that recorded `.m4v`/
// `.webm` in `skipped`) is served forever unless invalidated — this test
// simulates exactly that (poisoned manifest with a matching quickKey, served
// by ensureAlbum) and proves rebuildAlbum drops it and produces a fresh one.
// Real sharp, real build pass — no stubs. Run: npm run test:unit  (from gallery/)

const os = require('os')
const fs = require('fs')
const path = require('path')

// --- hermetic environment (set BEFORE requiring the app modules) ------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-album-rebuild-'))
const mk = (d) => {
  const p = path.join(tmp, d)
  fs.mkdirSync(p, { recursive: true })
  return p
}
process.env.NODE_ENV = 'test'
process.env.CONFIG_PATH = mk('config')
process.env.IMAGE_PATH = mk('images')
process.env.CACHE_PATH = mk('cache')

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
const albumDir = path.join(process.env.IMAGE_PATH, 'album1')
fs.mkdirSync(albumDir, { recursive: true })
fs.writeFileSync(path.join(albumDir, 'a.png'), PNG_1PX)
fs.writeFileSync(path.join(albumDir, 'b.png'), PNG_1PX)

const test = require('node:test')
const assert = require('node:assert')

const albumBuild = require('../handlers/album-build')

/** Poll until the album reports ready (builds run in the background). */
async function waitReady(album) {
  for (let i = 0; i < 200; i++) {
    const r = await albumBuild.ensureAlbum(album)
    if (r.state === 'ready') return r.manifest
    await new Promise((s) => setTimeout(s, 50))
  }
  throw new Error('album build did not become ready')
}

test('a stale manifest is served until rebuildAlbum drops it', async () => {
  // First build: both files render.
  const fresh = await waitReady('album1')
  assert.strictEqual(fresh.total, 2)
  assert.deepStrictEqual(fresh.skipped, [])

  // Simulate a manifest written by OLDER code: one file recorded as skipped,
  // but the stored quickKey still matches (the files never changed).
  const manifestPath = path.join(
    albumBuild.albumCacheDir('album1'),
    'manifest.json'
  )
  const poisoned = { ...fresh, total: 1, skipped: ['b.png'] }
  fs.writeFileSync(manifestPath, JSON.stringify(poisoned))

  // The fingerprint matches, so ensureAlbum keeps serving the stale build —
  // this IS the bug scenario (code fixed, cache forever stale).
  const served = await waitReady('album1')
  assert.deepStrictEqual(served.skipped, ['b.png'], 'stale manifest served')

  // The admin rebuild: drops the manifest and rebuilds with current code.
  await albumBuild.rebuildAlbum('album1')
  const rebuilt = await waitReady('album1')
  assert.strictEqual(rebuilt.total, 2, 'all files back after rebuild')
  assert.deepStrictEqual(rebuilt.skipped, [])
})

test('rebuildAlbum rejects a traversal album name (400) and an unknown album (404)', async () => {
  await assert.rejects(
    () => albumBuild.rebuildAlbum('../outside'),
    (err) => err.code === 400
  )
  await assert.rejects(
    () => albumBuild.rebuildAlbum('no-such-album'),
    (err) => err.code === 404
  )
})

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})
