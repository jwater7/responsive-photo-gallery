// vim: tabstop=2 shiftwidth=2 expandtab
'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { walkMedia } = require('..')

// Fixture tree exercising every traversal rule: mixed formats, non-media,
// dot-entries, a broken symlink, and a nested excludable directory.
function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'walker-'))
  const put = (rel, content = 'x') => {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  put('a.jpg')
  put('clip.M4V')
  put('scan.heic')
  put('notes.txt') // non-media: filtered out
  put('.hidden.jpg') // dot-file: skipped
  put('.hiddendir/inside.jpg') // dot-dir: not descended
  put('sub/b.png')
  put('sub/excluded/c.jpg') // dropped when shouldSkipDir excludes it
  put('sub/excluded/deeper/d.webm')
  fs.symlinkSync(path.join(root, 'gone.jpg'), path.join(root, 'broken.jpg')) // stat fails
  return root
}

test('walker: filters, dot-entries, broken symlink, nested exclude', async () => {
  const root = makeTree()

  const all = await walkMedia(root)
  assert.deepStrictEqual(
    all.map((f) => f.rel).sort(),
    ['a.jpg', 'clip.M4V', 'scan.heic', 'sub/b.png', 'sub/excluded/c.jpg', 'sub/excluded/deeper/d.webm']
  )
  for (const f of all) {
    assert.strictEqual(f.abs, path.join(root, ...f.rel.split('/')))
  }

  const excluded = await walkMedia(root, {
    shouldSkipDir: (rel) => rel === 'sub/excluded',
  })
  assert.deepStrictEqual(
    excluded.map((f) => f.rel).sort(),
    ['a.jpg', 'clip.M4V', 'scan.heic', 'sub/b.png']
  )

  fs.rmSync(root, { recursive: true, force: true })
})

test('walker: withStats returns size/mtimeMs; unreadable root yields []', async () => {
  const root = makeTree()

  const stats = await walkMedia(root, { withStats: true })
  for (const f of stats) {
    assert.strictEqual(typeof f.size, 'number')
    assert.strictEqual(typeof f.mtimeMs, 'number')
    assert.ok(f.size > 0)
  }

  const missing = await walkMedia(path.join(root, 'does-not-exist'))
  assert.deepStrictEqual(missing, [])

  fs.rmSync(root, { recursive: true, force: true })
})

test('walker: follows a working file symlink', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'walker-link-'))
  fs.writeFileSync(path.join(root, 'real.jpg'), 'x')
  fs.symlinkSync(path.join(root, 'real.jpg'), path.join(root, 'link.jpg'))
  const files = await walkMedia(root)
  assert.deepStrictEqual(files.map((f) => f.rel).sort(), ['link.jpg', 'real.jpg'])
  fs.rmSync(root, { recursive: true, force: true })
})
