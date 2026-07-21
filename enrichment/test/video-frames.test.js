// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// video-frames: sample-point math, real ffmpeg extraction (PNG buffers via
// pipe, no temp files), the single-entry memo the ocr+visual stages share,
// and the subprocess timeout kill. Run: npm test  (from enrichment/)

const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const config = require("../src/lib/config");
const { keyframes, sampleTimes } = require("../src/lib/video-frames");

test("sampleTimes: N frames span the middle 60% (20% → 80%)", () => {
  assert.deepStrictEqual(sampleTimes(10, 3), [2, 5, 8]);
  assert.deepStrictEqual(sampleTimes(100, 4), [20, 40, 60, 80]);
});

test("sampleTimes: a single frame lands at the midpoint", () => {
  assert.deepStrictEqual(sampleTimes(10, 1), [5]);
});

test("sampleTimes: never samples at/past the end", () => {
  for (const d of [0.5, 1, 2, 101]) {
    for (const t of sampleTimes(d, 5)) assert.ok(t < d, `${t} < ${d}`);
  }
});

test("sampleTimes: very short clip dedupes colliding timestamps", () => {
  // At 0.01s the rounded sample points collapse; fewer, distinct frames beat
  // identical ones.
  const times = sampleTimes(0.01, 3);
  assert.ok(times.length < 3);
  assert.strictEqual(new Set(times).size, times.length);
});

// ---- real ffmpeg integration (skipped where ffmpeg/ffprobe aren't installed) ----
const hasFfmpeg =
  spawnSync("ffmpeg", ["-version"]).status === 0 &&
  spawnSync("ffprobe", ["-version"]).status === 0;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function genClip(dir, name = "clip.mp4") {
  const file = path.join(dir, name);
  const gen = spawnSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
    file,
  ]);
  assert.strictEqual(gen.status, 0, "ffmpeg should generate the sample clip");
  return file;
}

test("keyframes: extracts N PNG buffers and memoizes per file", { skip: !hasFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-video-frames-"));
  try {
    const file = genClip(dir);
    const p1 = keyframes(file);
    const p2 = keyframes(file); // second stage of the same pipeline pass
    assert.strictEqual(p1, p2, "consecutive stages must share one extraction");

    const frames = await p1;
    assert.strictEqual(frames.length, config.videoFrameCount);
    for (const f of frames) {
      assert.ok(Buffer.isBuffer(f) && f.length > 0);
      assert.ok(f.subarray(0, 4).equals(PNG_MAGIC), "frame must be a PNG");
    }

    // A different file must not hit the previous entry.
    const other = genClip(dir, "other.mp4");
    assert.notStrictEqual(keyframes(other), p1);
    await keyframes(other);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("keyframes: rejects on an unprobeable file and never memoizes the rejection", { skip: !hasFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-video-frames-bad-"));
  try {
    const file = path.join(dir, "not-a-video.mp4");
    fs.writeFileSync(file, "this is not a video");
    const p1 = keyframes(file);
    await assert.rejects(() => p1);
    // The failed entry must be cleared so a later scan retries from scratch.
    assert.notStrictEqual(keyframes(file), p1);
    await assert.rejects(() => keyframes(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("keyframes: subprocess timeout kills a wedged child and rejects", { skip: !hasFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-video-frames-to-"));
  const saved = config.videoSubprocessTimeoutMs;
  try {
    const file = genClip(dir);
    config.videoSubprocessTimeoutMs = 1; // nothing legitimate finishes in 1ms
    await assert.rejects(() => keyframes(file));
  } finally {
    config.videoSubprocessTimeoutMs = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
