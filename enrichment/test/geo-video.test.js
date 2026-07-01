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

test("manual location preserved on re-scan (videoMeta not consulted)", async () => {
  throwNext = true; // would throw if videoMeta were called -> proves it is not
  const out = await geo.enrich({
    file: { relPath: "trip/clip.mov" },
    absPath: "/img/trip/clip.mov",
    existing: { geo_source: "manual", _geo: { lat: 1, lng: 2 } },
  });
  // Manual fix preserved (no videoMeta, no _geo rewrite), but its density cells
  // are (re)derived from the existing coordinate so a backfill reaches it too.
  assert.deepStrictEqual(out, { geo_checked: true, ...cellFields(1, 2) });
});

test("applies() dispatcher: geo opts into image+video; image-only enrichers skip video", () => {
  assert.strictEqual(geo.applies({ relPath: "a/clip.mov" }), true);
  assert.strictEqual(geo.applies({ relPath: "a/clip.mp4" }), true);
  assert.strictEqual(geo.applies({ relPath: "a/photo.jpg" }), true);

  for (const e of [ocr, caption]) {
    assert.strictEqual(e.applies({ relPath: "a/clip.mov" }), false, `${e.name} must skip video`);
    assert.strictEqual(e.applies({ relPath: "a/photo.jpg" }), true, `${e.name} must handle image`);
  }
  // The gate ocr/visual/caption share: image-only, never matches video.
  assert.strictEqual(SUPPORTED_FORMAT_REGEXP.test("a/clip.mov"), false);
});
