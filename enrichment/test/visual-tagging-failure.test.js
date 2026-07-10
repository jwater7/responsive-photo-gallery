// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// visual enricher failure semantics. Two bugs this guards against:
//   1. labelVectors() cached a REJECTED promise forever, so one transient
//      failure computing the label embeddings disabled tagging for the
//      worker's lifetime.
//   2. enrich() swallowed the tagging error and returned embedded:true with
//      empty tags — the pipeline version-stamped the stage current, so those
//      docs kept empty tags permanently (isCurrent skipped them on every
//      later scan).
// embedder is stubbed via the CJS require cache (injected BEFORE visual.js
// loads), so this runs hermetically with no onnxruntime/model download.
// Run: npm test  (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

// rpg-config resolves its files from CONFIG_PATH at load — give it a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-visual-tagging-test-"));
process.env.CONFIG_PATH = path.join(tmp, "config");
fs.mkdirSync(process.env.CONFIG_PATH, { recursive: true });

const test = require("node:test");
const assert = require("node:assert");

// ---- stub the embedder before requiring visual -----------------------------
let embedTextFails = false;
const embedderPath = require.resolve("../src/lib/embedder");
require.cache[embedderPath] = {
  id: embedderPath,
  filename: embedderPath,
  loaded: true,
  exports: {
    embedImage: async () => [1, 0],
    embedText: async () => {
      if (embedTextFails) throw new Error("model fetch interrupted");
      return [1, 0];
    },
  },
};

const visual = require("../src/enrichers/visual");

test("tagging failure is a soft error, not silently-empty tags", async () => {
  embedTextFails = true;
  const out = await visual.enrich({ absPath: "/img/a.jpg" });
  assert.match(out.error, /tagging failed: model fetch interrupted/);
  // Nothing durable: no marker/tags/vector that would stamp the stage current.
  assert.ok(!("embedded" in out));
  assert.ok(!("tags" in out));
  assert.ok(!("_vectors" in out));
});

test("a failed label-vector build is retried, not cached for the worker's lifetime", async () => {
  // The previous test left labelVectors() rejected; with the failure cleared
  // the very next enrich must succeed (the old code kept the rejected promise
  // and every subsequent image got empty tags forever).
  embedTextFails = false;
  const out = await visual.enrich({ absPath: "/img/b.jpg" });
  assert.strictEqual(out.embedded, true);
  assert.ok(Array.isArray(out.tags) && out.tags.length >= 1, "tags derived from the recovered label vectors");
  assert.ok(out._vectors, "stored vector present on success");
  assert.strictEqual(out.error, undefined);
});
