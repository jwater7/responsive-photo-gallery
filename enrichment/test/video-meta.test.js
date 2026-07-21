// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// video-meta: ISO6709 parsing, capture-date precedence, and (when ffprobe is
// present) a real probe of a generated clip. Run: npm test  (from enrichment/)

const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { parseISO6709, parseTakenAt, pickLocation, videoMeta } = require("../src/lib/video-meta");

test("parseISO6709: lat/lng with altitude", () => {
  assert.deepStrictEqual(parseISO6709("+47.1187-122.9301+034.945/"), {
    lat: 47.1187,
    lng: -122.9301,
  });
});

test("parseISO6709: lat/lng without altitude", () => {
  assert.deepStrictEqual(parseISO6709("+47.1187-122.9301/"), {
    lat: 47.1187,
    lng: -122.9301,
  });
});

test("parseISO6709: southern/eastern hemisphere signs", () => {
  assert.deepStrictEqual(parseISO6709("-33.8688+151.2093/"), {
    lat: -33.8688,
    lng: 151.2093,
  });
});

test("parseISO6709: null on missing/garbage", () => {
  assert.strictEqual(parseISO6709(undefined), null);
  assert.strictEqual(parseISO6709(""), null);
  assert.strictEqual(parseISO6709("nope"), null);
});

test("parseTakenAt: prefers tz-aware Apple creationdate over creation_time", () => {
  // The two strings denote the SAME instant, but the test proves the Apple key
  // wins when present (it carries the local offset the plain field may lack).
  const d = parseTakenAt({
    creation_time: "2021-11-17T05:32:21.000000Z",
    "com.apple.quicktime.creationdate": "2021-11-16T21:32:21-0800",
  });
  assert.strictEqual(d.toISOString(), "2021-11-17T05:32:21.000Z");
});

test("parseTakenAt: falls back to creation_time", () => {
  const d = parseTakenAt({ creation_time: "2020-01-02T03:04:05Z" });
  assert.strictEqual(d.toISOString(), "2020-01-02T03:04:05.000Z");
});

test("parseTakenAt: null when absent or unparseable", () => {
  assert.strictEqual(parseTakenAt({}), null);
  assert.strictEqual(parseTakenAt({ creation_time: "not-a-date" }), null);
});

test("pickLocation: Apple key wins over generic", () => {
  assert.strictEqual(
    pickLocation({
      location: "+1+2/",
      "com.apple.quicktime.location.ISO6709": "+47.6062-122.3321/",
    }),
    "+47.6062-122.3321/"
  );
});

test("pickLocation: generic location / location-eng (ffmpeg, Android)", () => {
  assert.strictEqual(pickLocation({ location: "+47.6062-122.3321/" }), "+47.6062-122.3321/");
  assert.strictEqual(pickLocation({ "location-eng": "+48.8566+2.3522/" }), "+48.8566+2.3522/");
});

test("pickLocation: case-insensitive (Matroska/webm LOCATION)", () => {
  assert.strictEqual(pickLocation({ LOCATION: "+48.8566+2.3522/" }), "+48.8566+2.3522/");
});

test("pickLocation: undefined when no location tag", () => {
  assert.strictEqual(pickLocation({ creation_time: "2020-01-01T00:00:00Z" }), undefined);
});

// ---- real ffprobe integration (skipped where ffmpeg/ffprobe aren't installed) ----
const hasFfmpeg =
  spawnSync("ffmpeg", ["-version"]).status === 0 &&
  spawnSync("ffprobe", ["-version"]).status === 0;

test("videoMeta: reads duration + dimensions + date from a real clip", { skip: !hasFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-video-meta-"));
  const file = path.join(dir, "clip.mp4");
  try {
    const gen = spawnSync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
      "-metadata", "creation_time=2021-11-17T05:32:21.000000Z",
      file,
    ]);
    assert.strictEqual(gen.status, 0, "ffmpeg should generate the sample clip");

    const meta = await videoMeta(file);
    assert.strictEqual(meta.width, 320);
    assert.strictEqual(meta.height, 240);
    assert.strictEqual(meta.duration, 2);
    assert.strictEqual(meta.takenAt.toISOString(), "2021-11-17T05:32:21.000Z");
    // No location atom was embedded -> graceful null, not an error.
    assert.strictEqual(meta.gps, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("videoMeta: throws on an unprobeable file", { skip: !hasFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-video-meta-bad-"));
  const file = path.join(dir, "not-a-video.mp4");
  try {
    fs.writeFileSync(file, "this is not a video");
    // The throw must now carry ffprobe's real reason (folded from stderr), not a
    // bare "Command failed" — that diagnostic is the whole point of `-v error`.
    await assert.rejects(() => videoMeta(file), /Invalid data|error reading|moov atom|not found/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
