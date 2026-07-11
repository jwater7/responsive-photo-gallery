// vim: tabstop=2 shiftwidth=2 expandtab
//
// Sprite build vs undecodable formats: a registry image format the running
// sharp build cannot decode (.bmp — no libvips loader in any build) is skipped
// VISIBLY (listed in the manifest's `skipped` with a logged reason) and the
// rest of the album still builds. Real sharp, real build pass — no stubs.
// Run: npm run test:unit  (from gallery/)

const os = require('os')
const fs = require('fs')
const path = require('path')

// --- hermetic environment (set BEFORE requiring the app modules) ------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-album-build-skip-'))
const mk = (d) => {
  const p = path.join(tmp, d)
  fs.mkdirSync(p, { recursive: true })
  return p
}
process.env.NODE_ENV = 'test'
process.env.CONFIG_PATH = mk('config')
process.env.IMAGE_PATH = mk('images')
process.env.CACHE_PATH = mk('cache')

// Fixture: one decodable image (real 1x1 PNG) + one undecodable-here .bmp.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
const albumDir = path.join(process.env.IMAGE_PATH, 'album1')
fs.mkdirSync(albumDir, { recursive: true })
fs.writeFileSync(path.join(albumDir, 'good.png'), PNG_1PX)
fs.writeFileSync(path.join(albumDir, 'bad.bmp'), 'not decodable by sharp')

const test = require('node:test')
const assert = require('node:assert')

const albumBuild = require('../handlers/album-build')

test('.bmp is skipped visibly and the rest of the album builds', async () => {
  const { files, albumHash } = await albumBuild.scanAlbum('album1')
  assert.deepStrictEqual(
    files.map((f) => f.rel).sort(),
    ['bad.bmp', 'good.png'],
    'the walker still discovers the bmp (supported format, listed/served raw)'
  )

  const manifest = await albumBuild.buildAlbum('album1', files, albumHash, 'qk')
  assert.strictEqual(manifest.total, 1, 'the png rendered')
  assert.deepStrictEqual(
    manifest.skipped,
    ['bad.bmp'],
    'the bmp is recorded, not silent'
  )
  assert.strictEqual(manifest.sheets.length, 1)
  assert.deepStrictEqual(
    manifest.sheets[0].cells.map((c) => c.image),
    ['good.png']
  )
  // The build completed: the sheet and manifest are on disk.
  const cacheDir = albumBuild.albumCacheDir('album1')
  assert.ok(fs.existsSync(path.join(cacheDir, 'manifest.json')))
  assert.ok(
    fs.existsSync(path.join(cacheDir, 'sprites', manifest.sheets[0].file))
  )
})

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})
