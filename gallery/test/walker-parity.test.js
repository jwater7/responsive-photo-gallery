// vim: tabstop=2 shiftwidth=2 expandtab
//
// Walker parity: ONE fixture tree (every registry format, dot-entries, a
// broken symlink, a nested excluded dir) walked through all three consumers —
// album-build's scan, enrichment's walkDir, and image-handler's list() — must
// yield the IDENTICAL file set. This is the consolidation's contract: the
// planes can no longer disagree about what media exists or what is hidden.
// fast-image-processing is stubbed (CJS require cache) so list() accepts the
// fake-byte fixtures without decoding them. Run: npm run test:unit (from gallery/)

const os = require('os')
const fs = require('fs')
const path = require('path')

// --- hermetic environment (set BEFORE requiring the app modules) ------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-walker-parity-'))
const mk = (d) => {
  const p = path.join(tmp, d)
  fs.mkdirSync(p, { recursive: true })
  return p
}
process.env.NODE_ENV = 'test'
process.env.CONFIG_PATH = mk('config')
process.env.IMAGE_PATH = mk('images')
process.env.TAGS_PATH = mk('tags')
process.env.CACHE_PATH = mk('cache')

// Nested exclude, honored by every plane.
fs.writeFileSync(
  path.join(process.env.CONFIG_PATH, 'excludes.json'),
  JSON.stringify({ excludes: ['albumx/excluded'] })
)

// --- one fixture tree --------------------------------------------------------
const { IMAGE_EXTS, VIDEO_EXTS } = require('rpg-media-types')

const albumDir = path.join(process.env.IMAGE_PATH, 'albumx')
const put = (rel) => {
  const abs = path.join(albumDir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, 'x')
}
const expected = []
// every registry format is discoverable
for (const ext of [...IMAGE_EXTS, ...VIDEO_EXTS]) {
  put(`formats/f${ext}`)
  expected.push(`formats/f${ext}`)
}
put('top.jpg')
expected.push('top.jpg')
put('notes.txt') // non-media
put('.hidden.jpg') // dot-file
put('.hiddendir/inside.jpg') // dot-dir
put('excluded/secret.jpg') // admin-excluded subtree
put('excluded/deeper/also.mp4')
fs.symlinkSync(
  path.join(albumDir, 'gone.jpg'),
  path.join(albumDir, 'broken.jpg')
)
expected.sort()

// --- stub fast-image-processing before requiring the handlers ---------------
const fipPath = require.resolve('fast-image-processing')
require.cache[fipPath] = {
  id: fipPath,
  filename: fipPath,
  loaded: true,
  exports: {
    getMetadata: (src, cb) => cb(undefined, { format: 'image' }),
    cacheThumbAndGetBuffer: (src, dest, w, h, cb) =>
      cb(undefined, Buffer.from('x'), 'image/png'),
    getNormalizedImageBuffer: (src, cb) =>
      cb(undefined, Buffer.from('x'), 'image/png'),
    renderCell: async () => {
      throw new Error('not needed here')
    },
    buildSpriteSheet: async () => {
      throw new Error('not needed here')
    },
  },
}

const test = require('node:test')
const assert = require('node:assert')

const albumBuild = require('../handlers/album-build')
const ImageHandler = require('../handlers/image-handler')
const enrichWalkDir = require('../../enrichment/src/lib/walk-dir')

test('album-build scan sees exactly the expected set', async () => {
  const { files } = await albumBuild.scanAlbum('albumx')
  assert.deepStrictEqual(files.map((f) => f.rel).sort(), expected)
})

test('enrichment walkDir sees exactly the expected set', async () => {
  const files = await enrichWalkDir(process.env.IMAGE_PATH, {
    excludes: ['albumx/excluded'],
  })
  assert.deepStrictEqual(
    files.map((f) => f.relPath).sort(),
    expected.map((rel) => `albumx/${rel}`)
  )
  for (const f of files) assert.strictEqual(f.album, 'albumx')
})

test('image-handler list() sees exactly the expected set', async () => {
  const handler = new ImageHandler(
    process.env.IMAGE_PATH,
    process.env.CACHE_PATH,
    process.env.TAGS_PATH
  )
  const res = await new Promise((resolve) =>
    handler.list('albumx', undefined, undefined, {}, resolve)
  )
  assert.ok(res.result, `expected a result, got ${JSON.stringify(res)}`)
  assert.deepStrictEqual(Object.keys(res.result).sort(), expected)
})

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})
