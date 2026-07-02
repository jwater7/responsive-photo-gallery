// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// pipeline.needsEmbedOptOut: whether a partial update must carry an
// `_vectors:{image:null}` opt-out so Meili's userProvided `image` embedder
// doesn't reject the whole task for a doc that has no stored vector. The bug this
// guards against: geo/ocr/caption writes to a not-yet-embedded doc were failing
// silently, freezing ~60k docs (missing map cells). Must never wipe a real vector.
// Run: npm test  (from enrichment/)

const test = require("node:test");
const assert = require("node:assert");

const { needsEmbedOptOut } = require("../src/lib/pipeline");

test("not-yet-embedded doc with a vector-less write → opt out", () => {
  // The frozen case: geo ran, existing doc has no vector (never through visual).
  assert.strictEqual(needsEmbedOptOut({ hash: "h", geo_version: 4 }, { embedded: undefined }), true);
  assert.strictEqual(needsEmbedOptOut({ hash: "h", geo_version: 4 }, {}), true);
});

test("brand-new doc (no existing) with a vector-less write → opt out", () => {
  // A new video, or a new image whose visual stage failed/didn't run this pass.
  assert.strictEqual(needsEmbedOptOut({ hash: "h", album: "a" }, null), true);
  assert.strictEqual(needsEmbedOptOut({ hash: "h", album: "a" }, undefined), true);
});

test("already-embedded doc → never opt out (would wipe the stored vector)", () => {
  assert.strictEqual(needsEmbedOptOut({ hash: "h", geo_version: 4 }, { embedded: true }), false);
});

test("write already carries a vector (visual ran this pass) → never opt out", () => {
  // update._vectors present → don't clobber the just-computed real vector, even
  // for a doc that wasn't embedded before.
  const update = { hash: "h", embedded: true, _vectors: { image: [0.1, 0.2] } };
  assert.strictEqual(needsEmbedOptOut(update, null), false);
  assert.strictEqual(needsEmbedOptOut(update, { embedded: undefined }), false);
});
