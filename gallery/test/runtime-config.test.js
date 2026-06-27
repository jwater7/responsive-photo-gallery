// vim: tabstop=2 shiftwidth=2 expandtab
//
// Gallery integration: albums() hides excluded directories. The exclude
// contract itself (normalize/isExcluded/round-trip/migration) is unit-tested in
// packages/config. Run: npm run test:unit

const os = require('os')
const fs = require('fs')
const path = require('path')

// Hermetic environment (set BEFORE requiring the modules under test). rpg-config
// reads CONFIG_PATH at module load.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-albums-exclude-test-'))
const mk = (d) => {
  const p = path.join(tmp, d)
  fs.mkdirSync(p, { recursive: true })
  return p
}
process.env.CONFIG_PATH = path.join(tmp, 'config')
delete process.env.AUTH_PATH
process.env.IMAGE_PATH = mk('images')
process.env.NODE_ENV = 'test'

const test = require('node:test')
const assert = require('node:assert')

const rc = require('rpg-config')

test('albums() hides top-level excluded albums (nested excludes do not)', async () => {
  const imagePath = process.env.IMAGE_PATH
  for (const d of ['keep', 'private', 'work', 'workshop']) {
    fs.mkdirSync(path.join(imagePath, d), { recursive: true })
  }
  await rc.setExcludes(['private', 'work/scans']) // top-level + nested

  const ImageHandler = require('../handlers/image-handler')
  const handler = new ImageHandler(imagePath, mk('cache'), mk('tags'))

  const result = await new Promise((resolve) => handler.albums(resolve))
  const names = Object.keys(result.result || {})
  assert.ok(names.includes('keep'))
  assert.ok(!names.includes('private')) // top-level exclude hidden
  assert.ok(names.includes('work')) // nested exclude does NOT hide the album
  assert.ok(names.includes('workshop')) // partial-name not excluded
})
