// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// Walker discovers videos alongside images, and mimeFor maps video extensions to
// video/* types (the base doc's mime_type drives video rendering on the frontend).
// Run: npm test  (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-video-discovery-"));
process.env.CONFIG_PATH = path.join(tmp, "config");
fs.mkdirSync(process.env.CONFIG_PATH, { recursive: true });

const test = require("node:test");
const assert = require("node:assert");

const walkDir = require("../src/lib/walk-dir");
const { mimeFor } = require("../src/lib/hash");

const base = path.join(tmp, "images");
const onDisk = [
  "trip/photo.jpg",
  "trip/clip.mov",
  "trip/clip.mp4",
  "trip/clip.m4v",
  "trip/clip.webm",
  "trip/notes.txt", // non-media: must be ignored
];
for (const rel of onDisk) {
  const abs = path.join(base, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "x");
}

test("walker collects images AND videos, skips non-media", () => {
  const got = walkDir(base).map((f) => f.relPath).sort();
  assert.deepStrictEqual(got, [
    "trip/clip.m4v",
    "trip/clip.mov",
    "trip/clip.mp4",
    "trip/clip.webm",
    "trip/photo.jpg",
  ]);
});

test("video regexp matches the four video extensions, not images", () => {
  assert.ok(walkDir.VIDEO_FORMAT_REGEXP.test("a.mov"));
  assert.ok(walkDir.VIDEO_FORMAT_REGEXP.test("a.MP4"));
  assert.ok(walkDir.VIDEO_FORMAT_REGEXP.test("a.m4v"));
  assert.ok(walkDir.VIDEO_FORMAT_REGEXP.test("a.webm"));
  assert.ok(!walkDir.VIDEO_FORMAT_REGEXP.test("a.jpg"));
});

test("mimeFor maps video extensions to video/* types", () => {
  assert.strictEqual(mimeFor("trip/clip.mov"), "video/quicktime");
  assert.strictEqual(mimeFor("trip/clip.mp4"), "video/mp4");
  assert.strictEqual(mimeFor("trip/clip.m4v"), "video/x-m4v");
  assert.strictEqual(mimeFor("trip/clip.webm"), "video/webm");
  // images unchanged
  assert.strictEqual(mimeFor("trip/photo.jpg"), "image/jpeg");
});
