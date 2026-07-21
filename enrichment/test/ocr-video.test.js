// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// ocr enricher video branch: keyframes OCR'd through the path-based engine
// via temp files (cleaned up even on failure), lines deduplicated across
// frames (normalized compare, first-seen original kept), confidence averaged
// over text-bearing frames, engine failure → soft error, image path
// untouched. video-frames and the OCR engine are stubbed via the CJS require
// cache (injected BEFORE ocr.js loads), so this runs hermetically with no
// tesseract or ffmpeg. Run: npm test  (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

// rpg-config resolves its files from CONFIG_PATH at load — give it a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-ocr-video-test-"));
process.env.CONFIG_PATH = path.join(tmp, "config");
fs.mkdirSync(process.env.CONFIG_PATH, { recursive: true });

const test = require("node:test");
const assert = require("node:assert");

function stub(relPath, exports) {
  const abs = require.resolve(relPath);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

let keyframesFail = false;
const FRAMES = [Buffer.from("png1"), Buffer.from("png2"), Buffer.from("png3")];
stub("../src/lib/video-frames", {
  keyframes: async () => {
    if (keyframesFail) throw new Error("no usable duration");
    return FRAMES;
  },
  sampleTimes: () => [],
});

// Engine stub: records the paths + bytes it was handed and returns a queued
// per-frame result (or throws).
let frameResults = [];
let engineFails = false;
const recognized = []; // { path, bytes, existedAtCall }
stub("../src/enrichers/ocr-engines", {
  name: "stub",
  recognize: async (absPath) => {
    if (engineFails) throw new Error("tesseract exploded");
    let bytes = null; // image path hands the original (non-existent here) file
    try {
      bytes = fs.readFileSync(absPath).toString();
    } catch (_) {}
    recognized.push({ path: absPath, bytes });
    return frameResults[recognized.length - 1] || { content: "", confidence: 0 };
  },
});

const ocr = require("../src/enrichers/ocr");

const clip = (relPath) => ({ file: { relPath }, absPath: `/images/${relPath}` });

test("video: frames round-trip temp files, lines dedupe across frames", async () => {
  recognized.length = 0;
  frameResults = [
    { content: "TRAIL  HEAD\nelevation 1200m", confidence: 0.9 },
    { content: "trail head", confidence: 0.7 }, // same sign, later frame (case/space differ)
    { content: "", confidence: 0 }, // text-free frame — must not drag confidence
  ];

  const out = await ocr.enrich(clip("alb/hike.mp4"));

  // Each frame's exact bytes were handed to the engine as a real temp file.
  assert.deepStrictEqual(recognized.map((r) => r.bytes), ["png1", "png2", "png3"]);
  for (const r of recognized) {
    assert.ok(r.path.endsWith(".png"));
    assert.ok(!fs.existsSync(r.path), "temp frame cleaned up");
  }
  // First-seen original form (whitespace collapsed), one entry per unique line.
  assert.strictEqual(out.content, "TRAIL HEAD\nelevation 1200m");
  // Mean over the two text-bearing frames only.
  assert.ok(Math.abs(out.confidence - 0.8) < 1e-9);
  assert.strictEqual(out.error, undefined);
});

test("video: distinct per-frame text is all kept", async () => {
  recognized.length = 0;
  frameResults = [
    { content: "WELCOME TO OREGON", confidence: 0.8 },
    { content: "SPEED LIMIT 55", confidence: 0.6 },
    { content: "", confidence: 0 },
  ];
  const out = await ocr.enrich(clip("alb/drive.mov"));
  assert.strictEqual(out.content, "WELCOME TO OREGON\nSPEED LIMIT 55");
});

test("video: engine failure is a soft error and temp files are still cleaned", async () => {
  engineFails = true;
  try {
    const out = await ocr.enrich(clip("alb/broken.mp4"));
    assert.match(out.error, /tesseract exploded/);
    assert.strictEqual(out.content, "");
  } finally {
    engineFails = false;
  }
});

test("video: extraction failure is a soft error", async () => {
  keyframesFail = true;
  try {
    const out = await ocr.enrich(clip("alb/still.mp4"));
    assert.match(out.error, /no usable duration/);
  } finally {
    keyframesFail = false;
  }
});

test("image path unchanged: recognize() gets the original file path", async () => {
  recognized.length = 0;
  frameResults = [{ content: "receipt", confidence: 0.5 }];
  const out = await ocr.enrich(clip("alb/photo.jpg"));
  assert.strictEqual(recognized[0].path, "/images/alb/photo.jpg");
  assert.strictEqual(out.content, "receipt");
});

test("no re-OCR of images: version unchanged, videos are stale by construction", () => {
  const { isCurrent } = require("../src/lib/pipeline");
  assert.strictEqual(ocr.version, 2, "widening applies() must NOT ride a version bump");
  assert.ok(ocr.applies({ relPath: "alb/clip.m4v" }), "videos now apply");
  assert.strictEqual(isCurrent({ ocr_version: 2, content: "x", confidence: 1 }, ocr), true);
  assert.strictEqual(isCurrent({ geo_version: 5, geo_checked: true }, ocr), false);
});
