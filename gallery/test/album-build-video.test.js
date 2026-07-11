// vim: tabstop=2 shiftwidth=2 expandtab
//
// album-build-cache contract: EVERY registry video format renders a sprite
// cell via ffmpeg. Previously fast-image-processing's local isVideo knew only
// .mov/.mp4, so .m4v/.webm were dispatched to sharp, failed to decode, and
// were SILENTLY skipped from album sprites. Real end-to-end build: tiny
// ffmpeg-generated clips, real frame extraction, real sheet composite. Skips
// (visibly) when ffmpeg isn't on PATH. Run: npm run test:unit  (from gallery/)

const os = require('os')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

// --- hermetic environment (set BEFORE requiring the app modules) ------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-album-build-video-'))
const mk = (d) => {
  const p = path.join(tmp, d)
  fs.mkdirSync(p, { recursive: true })
  return p
}
process.env.NODE_ENV = 'test'
process.env.CONFIG_PATH = mk('config')
process.env.IMAGE_PATH = mk('images')
process.env.CACHE_PATH = mk('cache')

const test = require('node:test')
const assert = require('node:assert')

const VIDEO_EXTS = ['.mov', '.mp4', '.m4v', '.webm']
const haveFfmpeg =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0

const albumDir = path.join(process.env.IMAGE_PATH, 'vids')
if (haveFfmpeg) {
  fs.mkdirSync(albumDir, { recursive: true })
  for (const ext of VIDEO_EXTS) {
    const res = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=0.5:size=64x64:rate=5',
        '-pix_fmt',
        'yuv420p',
        path.join(albumDir, `clip${ext}`),
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] }
    )
    assert.strictEqual(res.status, 0, `fixture encode failed for ${ext}`)
  }
}

const albumBuild = require('../handlers/album-build')

test(
  'every registry video format gets a sprite cell (format: video)',
  { skip: !haveFfmpeg && 'ffmpeg not on PATH' },
  async () => {
    const { files, albumHash } = await albumBuild.scanAlbum('vids')
    assert.strictEqual(files.length, VIDEO_EXTS.length)

    const manifest = await albumBuild.buildAlbum('vids', files, albumHash, 'qk')
    assert.deepStrictEqual(manifest.skipped, [], 'no video may be skipped')
    assert.strictEqual(manifest.total, VIDEO_EXTS.length)

    const cells = manifest.sheets.flatMap((s) => s.cells)
    for (const ext of VIDEO_EXTS) {
      const cell = cells.find((c) => c.image === `clip${ext}`)
      assert.ok(cell, `missing sprite cell for clip${ext}`)
      assert.strictEqual(
        cell.format,
        'video',
        `clip${ext} must be a video cell`
      )
    }
  }
)

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})
