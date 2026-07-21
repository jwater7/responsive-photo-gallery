// vim: tabstop=2 shiftwidth=2 expandtab
'use strict';

// cacheImageThumb must invoke its callback exactly ONCE when mkdirp rejects
// (unwritable/uncreatable thumb-cache dir). The old .catch(cb).then(pipeline)
// chain fired cb(err), then STILL ran the sharp pipeline, whose own failure on
// the missing dir fired cb a second time — upstream that meant two HTTP
// responses for one request (ERR_HTTP_HEADERS_SENT). mkdirp is stubbed via the
// CJS require cache (injected BEFORE index.js loads).
// Run: npm test  (from packages/fast-image-processing/)

const os = require('os');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

// ---- stub mkdirp before requiring the package ------------------------------
let mkdirpFails = false;
const mkdirpPath = require.resolve('mkdirp');
require.cache[mkdirpPath] = {
  id: mkdirpPath,
  filename: mkdirpPath,
  loaded: true,
  exports: {
    mkdirp: async (dir) => {
      if (mkdirpFails) throw new Error('EACCES: permission denied');
      await fs.promises.mkdir(dir, { recursive: true });
      return dir;
    },
  },
};

const fip = require('../index.js');

// A real (tiny, valid) source image so fs.stat and — on the success path —
// sharp both accept it. 1x1 PNG.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fip-callback-once-'));
const src = path.join(tmp, 'src.png');
fs.writeFileSync(src, PNG_1PX);

test('mkdirp failure fires the callback exactly once (with the error)', async () => {
  mkdirpFails = true;
  const dest = path.join(tmp, 'no-perms', 'thumbs', 'src.png');
  const calls = [];
  await new Promise((resolve) => {
    fip.cacheThumbAndGetBuffer(src, dest, 50, 50, (err, buf, type) => {
      calls.push({ err, buf, type });
      resolve();
    });
  });
  // Give the old bug's second (pipeline-failure) callback time to fire.
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(calls.length, 1, 'callback must fire exactly once');
  assert.match(calls[0].err.message, /EACCES/);
  assert.strictEqual(calls[0].buf, undefined);
});

test('success path still returns a thumbnail buffer once', async () => {
  mkdirpFails = false;
  const dest = path.join(tmp, 'ok', 'thumbs', 'src.png');
  const calls = [];
  await new Promise((resolve) => {
    fip.cacheThumbAndGetBuffer(src, dest, 50, 50, (err, buf, type) => {
      calls.push({ err, buf, type });
      resolve();
    });
  });
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].err, undefined);
  assert.ok(Buffer.isBuffer(calls[0].buf) && calls[0].buf.length > 0);
  assert.match(calls[0].type, /^image\//);
});
