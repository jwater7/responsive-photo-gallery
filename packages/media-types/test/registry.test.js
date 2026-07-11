// vim: tabstop=2 shiftwidth=2 expandtab
'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  IMAGE_EXTS,
  VIDEO_EXTS,
  isImage,
  isVideo,
  isMedia,
  mimeFor,
  MIME_BY_EXT,
  extsToRegexp,
  IMAGE_FORMAT_REGEXP,
  VIDEO_FORMAT_REGEXP,
  MEDIA_FORMAT_REGEXP,
  decodableImageExts,
} = require('..')

test('predicates classify by extension, case-insensitively', () => {
  assert.ok(isImage('a/b/photo.JPG'))
  assert.ok(isImage('scan.heic'))
  assert.ok(isVideo('clip.M4V'))
  assert.ok(isVideo('clip.webm'))
  assert.ok(!isImage('clip.webm'))
  assert.ok(!isVideo('scan.heic'))
  assert.ok(isMedia('x.avif'))
  assert.ok(isMedia('x.mov'))
  assert.ok(!isMedia('notes.txt'))
  assert.ok(!isMedia('archive.jpg.zip'))
})

test('every registry extension has a MIME type', () => {
  for (const ext of [...IMAGE_EXTS, ...VIDEO_EXTS]) {
    assert.ok(MIME_BY_EXT[ext], `missing MIME for ${ext}`)
  }
  assert.strictEqual(mimeFor('a/b.JPEG'), 'image/jpeg')
  assert.strictEqual(mimeFor('c.m4v'), 'video/x-m4v')
  assert.strictEqual(mimeFor('c.unknown'), 'application/octet-stream')
})

test('regexps are derived from the sets (no drift possible)', () => {
  for (const ext of IMAGE_EXTS) {
    assert.ok(IMAGE_FORMAT_REGEXP.test(`x${ext}`), `image regexp misses ${ext}`)
    assert.ok(MEDIA_FORMAT_REGEXP.test(`x${ext}`))
    assert.ok(!VIDEO_FORMAT_REGEXP.test(`x${ext}`))
  }
  for (const ext of VIDEO_EXTS) {
    assert.ok(VIDEO_FORMAT_REGEXP.test(`x${ext}`), `video regexp misses ${ext}`)
    assert.ok(MEDIA_FORMAT_REGEXP.test(`x${ext}`))
    assert.ok(!IMAGE_FORMAT_REGEXP.test(`x${ext}`))
  }
  assert.ok(IMAGE_FORMAT_REGEXP.test('UPPER.PNG'))
  assert.ok(!MEDIA_FORMAT_REGEXP.test('x.txt'))
  // extension must be terminal, not a substring
  assert.ok(!MEDIA_FORMAT_REGEXP.test('x.jpg.txt'))
  const custom = extsToRegexp(new Set(['.foo']))
  assert.ok(custom.test('a.FOO'))
  assert.ok(!custom.test('a.foobar'))
})

test('decodableImageExts reflects the passed sharp format map', () => {
  // Shape of require('sharp').format, reduced to what the probe reads.
  const withHeif = {
    jpeg: { input: { file: true } },
    png: { input: { file: true } },
    webp: { input: { file: true } },
    gif: { input: { file: true } },
    tiff: { input: { file: true } },
    heif: { input: { file: true } },
  }
  const withoutHeif = { ...withHeif, heif: { input: { file: false } } }

  const full = decodableImageExts(withHeif)
  assert.ok(full.has('.jpg') && full.has('.heic') && full.has('.avif'))
  assert.ok(!full.has('.bmp'), 'bmp is statically undecodable')

  const reduced = decodableImageExts(withoutHeif)
  assert.ok(reduced.has('.jpg') && reduced.has('.gif'))
  assert.ok(!reduced.has('.heic') && !reduced.has('.heif') && !reduced.has('.avif'))
})
