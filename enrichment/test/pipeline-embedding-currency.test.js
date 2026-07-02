// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// pipeline.hasEmbedding / embeddingLost: an embedding stage must re-run when its
// stored vector is gone, even if the `embedded` marker survived. This guards the
// exact freeze we hit: Meili purged the userProvided `_vectors.image` on an
// embedder-config change but left `embedded:true`, so `isCurrent` skipped `visual`
// forever and nothing re-embedded (visual_version was 0 across the whole index).
// Run: npm test  (from enrichment/)

const test = require("node:test");
const assert = require("node:assert");

const { hasEmbedding, embeddingLost } = require("../src/lib/pipeline");

const visual = { name: "visual", version: 1, outputFields: ["embedded"], embeds: true };
const geo = { name: "geo", version: 4, outputFields: ["geo_checked"] }; // not an embedding stage

// --- hasEmbedding: does the doc carry a real vector for the embedder? ----------

test("hasEmbedding: object shape { embeddings } with values is present", () => {
  assert.strictEqual(hasEmbedding({ _vectors: { image: { embeddings: [0.1, 0.2], regenerate: false } } }, "image"), true);
});

test("hasEmbedding: bare-array shape (older Meili) is present", () => {
  assert.strictEqual(hasEmbedding({ _vectors: { image: [0.1, 0.2] } }, "image"), true);
});

test("hasEmbedding: missing _vectors, wrong embedder, or empty vector are all absent", () => {
  assert.strictEqual(hasEmbedding({ embedded: true }, "image"), false); // the frozen doc: marker but no vector
  assert.strictEqual(hasEmbedding({ _vectors: {} }, "image"), false);
  assert.strictEqual(hasEmbedding({ _vectors: { other: [0.1] } }, "image"), false);
  assert.strictEqual(hasEmbedding({ _vectors: { image: { embeddings: [] } } }, "image"), false);
  assert.strictEqual(hasEmbedding(null, "image"), false);
});

// --- embeddingLost: the self-heal trigger --------------------------------------

test("embeddingLost: embedded marker but purged vector → stale (re-embed)", () => {
  // The exact incident: embedded:true, no _vectors → the stage must re-run.
  assert.strictEqual(embeddingLost(visual, { embedded: true }, "image"), true);
});

test("embeddingLost: marker AND real vector → not stale (don't re-embed the healthy ~9k)", () => {
  assert.strictEqual(embeddingLost(visual, { embedded: true, _vectors: { image: { embeddings: [0.1] } } }, "image"), false);
});

test("embeddingLost: non-embedding stage is never flagged (only enricher.embeds)", () => {
  assert.strictEqual(embeddingLost(geo, { geo_checked: true }, "image"), false);
});

test("embeddingLost: a new doc (no existing) is not flagged — isCurrent already runs it", () => {
  assert.strictEqual(embeddingLost(visual, null, "image"), false);
  assert.strictEqual(embeddingLost(visual, undefined, "image"), false);
});
