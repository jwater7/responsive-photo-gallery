// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// pipeline.runFile mime_type backfill: docs created before mime_type joined
// the base fields must gain it when a scan visits their canonical file (the
// excludeVideos filter needs the attribute), riding the same canonical-path
// stat-refresh that heals size/mtime — and the write must carry the vector
// opt-out for a not-yet-embedded doc (Meili's userProvided embedder rejects
// vector-less partial updates wholesale). meili/hash/enrichers are stubbed
// via the CJS require cache (injected BEFORE pipeline.js loads).
// Run: npm test  (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

// rpg-config resolves its files from CONFIG_PATH at load — give it a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-pipeline-mime-test-"));
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
    mimeFor: (p) => (p.endsWith(".mp4") ? "video/mp4" : "image/jpeg"),
    fileMtime: () => 1111,
    fileSize: () => 2222,
  },
};

// No enrichers: isolates the base-field/stat-refresh write path.
const enrichersPath = require.resolve("../src/enrichers");
require.cache[enrichersPath] = {
  id: enrichersPath,
  filename: enrichersPath,
  loaded: true,
  exports: [],
};

const config = require("../src/lib/config");
const { runFile } = require("../src/lib/pipeline");

const IMG = { album: "trip", relPath: "trip/a.jpg", absPath: "/img/trip/a.jpg" };
const VID = { album: "trip", relPath: "trip/c.mp4", absPath: "/img/trip/c.mp4" };
// Matches the hash stub so no stat-refresh fields muddy the assertions.
const CURRENT_STAT = { file_size: 2222, last_modified: 1111 };

test("canonical doc without mime_type is backfilled (vector opt-out included)", async () => {
  existingDoc = { hash: "h1", path: "trip/a.jpg", ...CURRENT_STAT };
  lastUpdate = null;
  await runFile(IMG);
  assert.ok(lastUpdate, "a write must happen");
  assert.strictEqual(lastUpdate.mime_type, "image/jpeg");
  // Not-yet-embedded doc: the partial update must opt out of the userProvided
  // embedder or Meili fails the whole task.
  assert.deepStrictEqual(lastUpdate._vectors, { [config.embedderName]: null });
});

test("video docs backfill their video MIME", async () => {
  existingDoc = { hash: "h1", path: "trip/c.mp4", ...CURRENT_STAT };
  lastUpdate = null;
  await runFile(VID);
  assert.strictEqual(lastUpdate.mime_type, "video/mp4");
});

test("a doc that already has mime_type is not re-stamped (no write at all)", async () => {
  // embedded:true so the ever-present vector opt-out (which itself forces a
  // write for any not-yet-embedded doc) doesn't mask the no-op.
  existingDoc = { hash: "h1", path: "trip/a.jpg", mime_type: "image/jpeg", embedded: true, ...CURRENT_STAT };
  lastUpdate = null;
  await runFile(IMG);
  assert.strictEqual(lastUpdate, null, "nothing changed → no Meili write");
});

test("a duplicate copy (non-canonical path) does not stamp the owner's doc", async () => {
  // Same content hash, different path: only the canonical path refreshes base
  // fields (see the stat-refresh comment in runFile) — the duplicate must not
  // sneak a mime_type in either.
  existingDoc = { hash: "h1", path: "trip/original.jpg", embedded: true, ...CURRENT_STAT };
  lastUpdate = null;
  await runFile(IMG);
  assert.strictEqual(lastUpdate, null, "duplicate visit → no write, no mime_type");

  // And even on a doc that DOES get written (not yet embedded), the duplicate
  // path must not contribute mime_type.
  existingDoc = { hash: "h1", path: "trip/original.jpg", ...CURRENT_STAT };
  lastUpdate = null;
  await runFile(IMG);
  if (lastUpdate) assert.ok(!("mime_type" in lastUpdate), "no mime_type from a duplicate");
});
