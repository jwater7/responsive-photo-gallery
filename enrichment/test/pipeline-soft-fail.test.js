// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// pipeline.runFile soft-failure semantics: an enricher that reports a soft
// failure (an `error` field alongside its — usually empty — output) must NOT
// have that output merged into the Meili update. The bug this guards against:
// a transient OCR timeout on a re-run (version bump / force / embeddingLost)
// returned { content: "", confidence: 0, error } and the empty content was
// written over the doc's previously good searchable text. meili/hash/enrichers
// are stubbed via the CJS require cache (injected BEFORE pipeline.js loads).
// Run: npm test  (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

// rpg-config resolves its files from CONFIG_PATH at load — give it a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-pipeline-softfail-test-"));
process.env.CONFIG_PATH = path.join(tmp, "config");
fs.mkdirSync(process.env.CONFIG_PATH, { recursive: true });

const test = require("node:test");
const assert = require("node:assert");

// ---- stub meili + hash + the enricher registry before requiring pipeline ---
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

const hashPath = require.resolve("../src/lib/hash");
require.cache[hashPath] = {
  id: hashPath,
  filename: hashPath,
  loaded: true,
  exports: {
    computeHash: async () => "h1",
    mimeFor: () => "image/jpeg",
    fileMtime: () => 1111,
    fileSize: () => 2222,
  },
};

let enrichResult = null;
const fakeOcr = {
  name: "ocr",
  version: 2,
  outputFields: ["content", "confidence"],
  enrich: async () => enrichResult,
};
const enrichersPath = require.resolve("../src/enrichers");
require.cache[enrichersPath] = {
  id: enrichersPath,
  filename: enrichersPath,
  loaded: true,
  exports: [fakeOcr],
};

const { runFile } = require("../src/lib/pipeline");

const FILE = { album: "trip", relPath: "trip/a.jpg", absPath: "/img/trip/a.jpg" };
// Matches the hash stub so no stat-refresh fields muddy the assertions.
const baseDoc = { hash: "h1", path: "trip/a.jpg", file_size: 2222, last_modified: 1111 };

test("soft failure on a re-run does NOT overwrite previously good fields", async () => {
  // Doc with good OCR text from v1; version bump to 2 forces a re-run that
  // times out. The empty output must not be merged — only the error recorded.
  existingDoc = { ...baseDoc, content: "RECEIPT total 12.34", confidence: 81, ocr_version: 1, embedded: true };
  lastUpdate = null;
  enrichResult = { content: "", confidence: 0, error: "ocr timed out after 120000ms" };

  const res = await runFile(FILE);

  assert.deepStrictEqual(res.failed, ["ocr"]);
  assert.ok(lastUpdate, "a partial update is still written (the error field)");
  assert.strictEqual(lastUpdate.ocr_error, "ocr timed out after 120000ms");
  assert.ok(!("content" in lastUpdate), "empty content must not wipe the good text");
  assert.ok(!("confidence" in lastUpdate), "empty confidence must not be merged");
  assert.ok(!("ocr_version" in lastUpdate), "a failed stage is not version-stamped");
});

test("success merges output, stamps the version, and clears a prior error", async () => {
  existingDoc = { ...baseDoc, ocr_error: "ocr timed out after 120000ms", embedded: true };
  lastUpdate = null;
  enrichResult = { content: "HELLO WORLD", confidence: 92 };

  const res = await runFile(FILE);

  assert.deepStrictEqual(res.ran, ["ocr"]);
  assert.strictEqual(lastUpdate.content, "HELLO WORLD");
  assert.strictEqual(lastUpdate.ocr_version, 2);
  assert.strictEqual(lastUpdate.ocr_error, null);
});

test("soft failure on a NEW doc still writes the base doc + error (retried later)", async () => {
  existingDoc = null;
  lastUpdate = null;
  enrichResult = { content: "", confidence: 0, error: "ocr timed out after 120000ms" };

  const res = await runFile(FILE);

  assert.deepStrictEqual(res.failed, ["ocr"]);
  assert.strictEqual(lastUpdate.album, "trip");
  assert.strictEqual(lastUpdate.ocr_error, "ocr timed out after 120000ms");
  assert.ok(!("content" in lastUpdate));
  assert.ok(!("ocr_version" in lastUpdate));
});
