// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// geo enricher video branch + the applies() dispatcher contract. video-meta and
// geonames are stubbed via the CJS require cache (injected BEFORE geo.js loads),
// so this runs hermetically with no ffprobe and no GeoNames dataset.
// Run: npm test  (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

// rpg-config resolves EXCLUDES_FILE from CONFIG_PATH at load — give it a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-geo-video-test-"));
process.env.CONFIG_PATH = path.join(tmp, "config");
fs.mkdirSync(process.env.CONFIG_PATH, { recursive: true });

const test = require("node:test");
const assert = require("node:assert");

// ---- stub video-meta + geonames before requiring geo ----------------------
let fakeMeta = null;
let throwNext = false;
const vmPath = require.resolve("../src/lib/video-meta");
require.cache[vmPath] = {
  id: vmPath,
  filename: vmPath,
  loaded: true,
  exports: {
    videoMeta: async () => {
      if (throwNext) throw new Error("ffprobe failed");
      return fakeMeta;
    },
  },
};
const gnPath = require.resolve("../src/lib/geonames");
require.cache[gnPath] = {
  id: gnPath,
  filename: gnPath,
  loaded: true,
  exports: {
    reverse: () => ({ city: "Tacoma", region: "Washington", country: "United States" }),
    loadOnce: () => {},
    placeString: (p) => (p ? [p.city, p.region, p.country].filter(Boolean).join(", ") : ""),
  },
};

const geo = require("../src/enrichers/geo");
const { cellFields } = require("../src/lib/geo-cells");
const ocr = require("../src/enrichers/ocr");
const caption = require("../src/enrichers/caption");
// visual.js uses the same image-only SUPPORTED_FORMAT_REGEXP as ocr/caption but
// pulls in onnxruntime at require time, so it is exercised via the regexp below
// rather than loaded here.
const { SUPPORTED_FORMAT_REGEXP } = require("../src/lib/walk-dir");

const VIDEO = { file: { relPath: "trip/clip.mov" }, absPath: "/img/trip/clip.mov", existing: null };

test("video with GPS → _geo + geo_source:quicktime + date/duration/dims + place", async () => {
  throwNext = false;
  fakeMeta = {
    gps: { lat: 47.1187, lng: -122.9301 },
    takenAt: new Date("2021-11-16T21:32:21-0800"),
    duration: 42,
    width: 1920,
    height: 1080,
  };
  const out = await geo.enrich(VIDEO);
  assert.deepStrictEqual(out._geo, { lat: 47.1187, lng: -122.9301 });
  assert.strictEqual(out.geo_source, "quicktime");
  assert.strictEqual(out.taken_at, new Date("2021-11-16T21:32:21-0800").toISOString());
  assert.strictEqual(out.duration, 42);
  assert.strictEqual(out.width, 1920);
  assert.strictEqual(out.height, 1080);
  assert.strictEqual(out.place_city, "Tacoma");
  assert.strictEqual(out.geo_checked, true);
  assert.ok(!("error" in out));
  // H3 density cells are derived from the coordinate (every persisted resolution).
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(out).filter(([k]) => k.startsWith("cell_r"))),
    cellFields(47.1187, -122.9301)
  );
});

test("video without GPS → no _geo/geo_source/error; still date/duration/dims", async () => {
  throwNext = false;
  fakeMeta = { gps: null, takenAt: new Date("2020-01-02T03:04:05Z"), duration: 10, width: 640, height: 480 };
  const out = await geo.enrich(VIDEO);
  assert.ok(!("_geo" in out));
  assert.ok(!("geo_source" in out));
  assert.ok(!("error" in out));
  assert.strictEqual(out.taken_at, "2020-01-02T03:04:05.000Z");
  assert.strictEqual(out.duration, 10);
  assert.strictEqual(out.geo_checked, true);
});

test("ffprobe failure → soft error recorded, geo_checked still set", async () => {
  throwNext = true;
  const out = await geo.enrich(VIDEO);
  assert.strictEqual(out.error, "ffprobe failed");
  assert.strictEqual(out.geo_checked, true);
  assert.ok(!("_geo" in out));
});

test("manual location preserved on re-scan; non-location metadata still extracted", async () => {
  throwNext = false;
  fakeMeta = {
    gps: { lat: 9, lng: 9 }, // embedded GPS must NOT clobber the manual pin
    takenAt: new Date("2020-01-02T03:04:05Z"),
    duration: 10,
    width: 640,
    height: 480,
  };
  const out = await geo.enrich({
    file: { relPath: "trip/clip.mov" },
    absPath: "/img/trip/clip.mov",
    existing: { geo_source: "manual", _geo: { lat: 1, lng: 2 } },
  });
  // Location fields stay the pin's: neither rewritten nor replaced by the
  // embedded GPS (the extracted place belongs to that GPS and is dropped too).
  assert.ok(!("_geo" in out));
  assert.ok(!("geo_source" in out));
  assert.ok(!("place" in out));
  // The old early-return skipped extraction entirely, so a doc pinned before
  // its first successful geo pass permanently lost its capture date/duration.
  assert.strictEqual(out.taken_at, "2020-01-02T03:04:05.000Z");
  assert.strictEqual(out.duration, 10);
  // Density cells are (re)derived from the PIN, not the embedded GPS.
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(out).filter(([k]) => k.startsWith("cell_r"))),
    cellFields(1, 2)
  );
});

test("manual pin + failed extraction → soft error (retried), pin cells still derived", async () => {
  throwNext = true;
  const out = await geo.enrich({
    file: { relPath: "trip/clip.mov" },
    absPath: "/img/trip/clip.mov",
    existing: { geo_source: "manual", _geo: { lat: 1, lng: 2 } },
  });
  assert.strictEqual(out.error, "ffprobe failed");
  assert.ok(!("_geo" in out));
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(out).filter(([k]) => k.startsWith("cell_r"))),
    cellFields(1, 2)
  );
});

test("applies() dispatcher: geo/ocr opt into image+video; caption stays image-only", () => {
  // Since add-video-embeddings-and-search-filter, ocr (and visual — exercised
  // in visual-video.test.js) handle video via keyframes; caption remains
  // image-only (videos carry no embedded caption metadata worth parsing).
  for (const e of [geo, ocr]) {
    assert.strictEqual(e.applies({ relPath: "a/clip.mov" }), true, `${e.name} must handle video`);
    assert.strictEqual(e.applies({ relPath: "a/clip.mp4" }), true, `${e.name} must handle video`);
    assert.strictEqual(e.applies({ relPath: "a/photo.jpg" }), true, `${e.name} must handle image`);
  }
  assert.strictEqual(caption.applies({ relPath: "a/clip.mov" }), false, "caption must skip video");
  assert.strictEqual(caption.applies({ relPath: "a/photo.jpg" }), true, "caption must handle image");
  // The image-only gate caption uses: never matches video.
  assert.strictEqual(SUPPORTED_FORMAT_REGEXP.test("a/clip.mov"), false);
});
