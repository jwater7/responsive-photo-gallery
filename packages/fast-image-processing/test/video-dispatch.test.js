// vim: tabstop=2 shiftwidth=2 expandtab
'use strict';

// Render dispatch must come from the shared registry: EVERY registry video
// format (.mov/.mp4/.m4v/.webm) goes to the ffmpeg path, never sharp. The old
// local isVideo knew only .mov/.mp4, so renderCell fed .m4v/.webm to sharp,
// sharp failed, and album builds silently skipped them. fluent-ffmpeg is
// stubbed via the CJS require cache (injected BEFORE index.js loads) to record
// which sources take the video path — no ffmpeg binary needed.
// Run: npm test  (from packages/fast-image-processing/)

const os = require('os');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

// A real 1x1 PNG the stub "screenshots" into place so the sharp cell-encode
// step after frame extraction succeeds.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// ---- stub fluent-ffmpeg before requiring the package ------------------------
const screenshotted = [];
function ffmpegStub(src) {
  const handlers = {};
  const api = {
    on(event, fn) {
      handlers[event] = fn;
      return api;
    },
    screenshots({ folder, filename }) {
      screenshotted.push(src);
      fs.writeFile(path.join(folder, filename), PNG_1PX, (err) => {
        if (err) return handlers.error && handlers.error(err);
        return handlers.end && handlers.end();
      });
      return api;
    },
  };
  return api;
}
ffmpegStub.ffprobe = (src, cb) => cb(null, { streams: [], format: {} });
const ffmpegPath = require.resolve('fluent-ffmpeg');
require.cache[ffmpegPath] = {
  id: ffmpegPath,
  filename: ffmpegPath,
  loaded: true,
  exports: ffmpegStub,
};

const fip = require('../index.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fip-video-dispatch-'));

test('renderCell dispatches every registry video format to ffmpeg', async () => {
  for (const ext of ['.mov', '.mp4', '.m4v', '.webm']) {
    const src = path.join(tmp, `clip${ext}`);
    fs.writeFileSync(src, 'not-really-a-video'); // stat only; ffmpeg is stubbed
    const cell = await fip.renderCell(src, 8);
    assert.strictEqual(cell.format, 'video', `${ext} must render as video`);
    assert.ok(screenshotted.includes(src), `${ext} must take the ffmpeg path`);
  }
});

test('renderCell keeps images on the sharp path', async () => {
  const src = path.join(tmp, 'photo.png');
  fs.writeFileSync(src, PNG_1PX);
  const cell = await fip.renderCell(src, 8);
  assert.strictEqual(cell.format, 'image');
  assert.ok(!screenshotted.includes(src), 'images must not hit ffmpeg');
});

test('cacheThumb routes registry video formats through the ffmpeg path', async () => {
  const src = path.join(tmp, 'thumbme.webm');
  fs.writeFileSync(src, 'not-really-a-video');
  const dest = path.join(tmp, 'cache', 'thumbme.webm.PNG');
  const result = await new Promise((resolve) => {
    fip.cacheThumbAndGetBuffer(src, dest, 8, 8, (err, buf, type) =>
      resolve({ err, buf, type })
    );
  });
  assert.strictEqual(result.err, undefined);
  assert.ok(screenshotted.includes(src), '.webm thumb must take the ffmpeg path');
  assert.ok(Buffer.isBuffer(result.buf) && result.buf.length > 0);
});
