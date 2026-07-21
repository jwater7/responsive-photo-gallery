// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// POST /geo (manual pin) embed opt-out. Meili's userProvided embedder
// re-validates vectors on EVERY partial update, so pinning a location on a
// doc with no stored vector (a video, or an image the visual stage hasn't
// embedded) failed the whole task AFTER the route had already returned ok —
// the pin was silently discarded (the write-loss incident mechanism). The
// route must opt out with _vectors:{<embedder>:null} exactly like the
// pipeline, and must NOT emit the opt-out for an embedded doc (that would
// wipe its stored vector). meili/geonames/embedder are stubbed via the CJS
// require cache (injected BEFORE the router loads).
// Run: npm test  (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

// rpg-config resolves its files from CONFIG_PATH at load — give it a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-geo-pin-route-test-"));
process.env.CONFIG_PATH = path.join(tmp, "config");
fs.mkdirSync(process.env.CONFIG_PATH, { recursive: true });

const test = require("node:test");
const assert = require("node:assert");

// ---- stubs before requiring the router -------------------------------------
let existingDoc = null;
let lastUpdate = null;
const meiliPath = require.resolve("../src/lib/meili");
require.cache[meiliPath] = {
  id: meiliPath,
  filename: meiliPath,
  loaded: true,
  exports: {
    init: async () => {},
    getDoc: async () => existingDoc,
    updateFields: async (fields) => {
      lastUpdate = fields;
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
    forward: () => null,
    loadOnce: () => {},
  },
};
// Keeps the test hermetic/fast: the router's require chain would otherwise
// pull in onnxruntime via the embedder.
const embedderPath = require.resolve("../src/lib/embedder");
require.cache[embedderPath] = {
  id: embedderPath,
  filename: embedderPath,
  loaded: true,
  exports: { embedImage: async () => [], embedText: async () => [], load: async () => {} },
};

const express = require("express");
const config = require("../src/lib/config");
const router = require("../src/routes/enrichment-api");

let server;
let base;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server && server.close());

const pin = (body) =>
  fetch(`${base}/geo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("pin on a NOT-yet-embedded doc (e.g. a video) → write carries the vector opt-out", async () => {
  existingDoc = { hash: "h1", path: "trip/clip.mov" }; // no `embedded` marker
  lastUpdate = null;
  const res = await pin({ hash: "h1", lat: 47.1187, lng: -122.9301 });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(lastUpdate._geo, { lat: 47.1187, lng: -122.9301 });
  assert.strictEqual(lastUpdate.geo_source, "manual");
  assert.deepStrictEqual(lastUpdate._vectors, { [config.embedderName]: null });
});

test("pin on an EMBEDDED doc → no opt-out (it would wipe the stored vector)", async () => {
  existingDoc = { hash: "h2", path: "trip/a.jpg", embedded: true };
  lastUpdate = null;
  const res = await pin({ hash: "h2", lat: 1, lng: 2 });
  assert.strictEqual(res.status, 200);
  assert.ok(!("_vectors" in lastUpdate), "an embedded doc's write must not carry a null vector");
});

test("pin on an unindexed hash → 404, nothing written", async () => {
  existingDoc = null;
  lastUpdate = null;
  const res = await pin({ hash: "nope", lat: 1, lng: 2 });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(lastUpdate, null);
});

test("missing/invalid hash/lat/lng → 400", async () => {
  existingDoc = { hash: "h3" };
  for (const body of [{}, { hash: "h3", lat: 1 }, { hash: "h3", lat: "x", lng: 2 }]) {
    const res = await pin(body);
    assert.strictEqual(res.status, 400);
  }
});
