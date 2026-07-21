// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// /search excludeVideos: the route must append a registry-derived
// `NOT mime_type IN [...]` filter that composes with the existing params, and
// the NOT-form's semantics must hold on a real Meili — set complement
// INCLUDING docs missing the attribute, so images from before mime_type
// existed stay visible during the backfill window (the design's explicit
// don't-trust-blind assumption).
//
// Two layers, matching search-sort-hybrid.test.js:
//   1. Route tests (always run): meili/embedder stubbed via the CJS require
//      cache, real express listener, assert the filter meili.search receives.
//   2. Meili integration (skipped when unreachable): image + video + legacy
//      (attribute-less) docs on a throwaway index; the filter keeps image and
//      legacy, drops video, in keyword mode and composed with a sort.
// Run: npm test  (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

// rpg-config resolves its files from CONFIG_PATH at load — give it a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-search-exclvid-test-"));
process.env.CONFIG_PATH = path.join(tmp, "config");
fs.mkdirSync(process.env.CONFIG_PATH, { recursive: true });

const test = require("node:test");
const assert = require("node:assert");
const { VIDEO_MIME_TYPES } = require("rpg-media-types");

// ---- stubs before requiring the router -------------------------------------
let lastSearch = null; // { query, opts }
const meiliPath = require.resolve("../src/lib/meili");
require.cache[meiliPath] = {
  id: meiliPath,
  filename: meiliPath,
  loaded: true,
  exports: {
    init: async () => {},
    search: async (query, opts) => {
      lastSearch = { query, opts };
      return { hits: [], estimatedTotalHits: 0 };
    },
  },
};
// Keeps the test hermetic/fast: the router's require chain would otherwise
// pull in onnxruntime via the embedder.
const embedderPath = require.resolve("../src/lib/embedder");
require.cache[embedderPath] = {
  id: embedderPath,
  filename: embedderPath,
  loaded: true,
  exports: { embedImage: async () => [], embedText: async () => [0, 1], load: async () => {} },
};

const express = require("express");
const config = require("../src/lib/config");
const router = require("../src/routes/enrichment-api");

let server;
let base;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", router);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server && server.close());

async function search(body) {
  const r = await fetch(`${base}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

const videoFilter = (filters) =>
  (filters || []).find((f) => typeof f === "string" && f.startsWith("NOT mime_type IN ["));

test("excludeVideos appends the registry-derived NOT filter", async () => {
  lastSearch = null;
  const { status } = await search({ query: "beach", semanticRatio: 0, excludeVideos: true });
  assert.strictEqual(status, 200);
  const f = videoFilter(lastSearch.opts.filter);
  assert.ok(f, "video filter present");
  // Every registry video MIME must appear, quoted — a new registry format is
  // covered with no route change.
  for (const mime of VIDEO_MIME_TYPES) assert.ok(f.includes(`"${mime}"`), mime);
});

test("excludeVideos composes with other filters and sort", async () => {
  lastSearch = null;
  await search({
    query: "beach",
    semanticRatio: 0,
    excludeVideos: true,
    takenAfter: "2020-01-01T00:00:00.000Z",
    sort: "date:desc",
  });
  const filters = lastSearch.opts.filter;
  assert.ok(videoFilter(filters));
  assert.ok(filters.some((f) => f.startsWith("taken_at >=")));
  assert.deepStrictEqual(lastSearch.opts.sort, ["taken_at:desc", "last_modified:desc"]);
});

test("without excludeVideos no mime filter is sent (default unchanged)", async () => {
  lastSearch = null;
  await search({ query: "beach", semanticRatio: 0 });
  assert.strictEqual(videoFilter(lastSearch.opts.filter), undefined);
});

// ---------------------------------------------------------------------------
// Layer 2: real Meili — NOT-form semantics (complement includes docs missing
// the attribute). Gated like embed-optout-meili.test.js.
// ---------------------------------------------------------------------------
const BASE = config.meiliHostUrl.replace(/\/$/, "");
const AUTH = config.meiliApiKey ? { Authorization: `Bearer ${config.meiliApiKey}` } : {};
const JSON_HEADERS = { "Content-Type": "application/json", ...AUTH };

async function reachable() {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch (_) {
    return false;
  }
}

async function req(method, p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.json();
}

async function waitTask(taskUid) {
  for (let i = 0; i < 100; i++) {
    const t = await fetch(`${BASE}/tasks/${taskUid}`, { headers: AUTH }).then((r) => r.json());
    if (t.status !== "enqueued" && t.status !== "processing") return t;
    await new Promise((s) => setTimeout(s, 100));
  }
  throw new Error(`task ${taskUid} did not settle`);
}

test("Meili: NOT mime_type IN keeps images AND attribute-less legacy docs, drops videos", async (t) => {
  if (!(await reachable())) return t.skip(`Meili not reachable at ${BASE}`);
  const IDX = `test_excl_videos_${Date.now()}`;
  try {
    await waitTask((await req("POST", "/indexes", { uid: IDX, primaryKey: "hash" })).taskUid);
    await waitTask(
      (await req("PATCH", `/indexes/${IDX}/settings`, { filterableAttributes: ["mime_type"] })).taskUid
    );
    await waitTask(
      (await req("PUT", `/indexes/${IDX}/documents`, [
        { hash: "img", mime_type: "image/jpeg" },
        { hash: "vid", mime_type: "video/mp4" },
        { hash: "mov", mime_type: "video/quicktime" },
        { hash: "legacy" }, // indexed before mime_type existed
      ])).taskUid
    );
    // The exact expression the route builds.
    const filter = `NOT mime_type IN [${VIDEO_MIME_TYPES.map((m) => `"${m}"`).join(", ")}]`;
    const res = await req("POST", `/indexes/${IDX}/search`, { q: "", filter: [filter], limit: 10 });
    assert.deepStrictEqual(
      (res.hits || []).map((h) => h.hash).sort(),
      ["img", "legacy"],
      "videos dropped; image and legacy (missing attribute) kept"
    );
  } finally {
    await req("DELETE", `/indexes/${IDX}`).catch(() => {});
  }
});
