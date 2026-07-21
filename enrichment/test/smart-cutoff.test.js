// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// Smart-search relative cutoff, two layers:
//   1. applySmartCutoff unit tests — window / min floor / max cap semantics
//      on the score regimes actually measured (flat band, keyword spike,
//      clear winner).
//   2. Route tests — /search `smartCutoff: true` fetches the full working set
//      once, trims server-side, pages from the trimmed set with an exact
//      `total`, composes with the manual date sort (trim THEN sort), and is
//      ignored on the keyword path. meili/embedder stubbed via the CJS
//      require cache (injected BEFORE the router loads).
// Run: npm test  (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

// rpg-config resolves its files from CONFIG_PATH at load — give it a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-smart-cutoff-test-"));
process.env.CONFIG_PATH = path.join(tmp, "config");
fs.mkdirSync(process.env.CONFIG_PATH, { recursive: true });

const test = require("node:test");
const assert = require("node:assert");

const { applySmartCutoff } = require("../src/lib/smart-cutoff");

const CFG = { smartCutoffWindow: 0.02, smartMinResults: 3, smartMaxResults: 6 };
const hit = (id, s) => ({ id, _rankingScore: s });

test("window: a clear winner sheds the junk band below it", () => {
  // The measured shape: one genuine match, then a dense band > window lower.
  const hits = [hit("real", 0.66), hit("j1", 0.63), hit("j2", 0.629), hit("j3", 0.628)];
  // Window keeps only "real" (floor 0.64) — the min floor then backfills by
  // rank, but never past min.
  assert.deepStrictEqual(applySmartCutoff(hits, CFG).map((h) => h.id), ["real", "j1", "j2"]);
});

test("min floor: a keyword spike (≈1.0) cannot window away the semantic hits", () => {
  const hits = [hit("kw", 1.0), hit("s1", 0.64), hit("s2", 0.63), hit("s3", 0.62)];
  // top−window = 0.98 keeps only "kw"; the floor keeps the best 3 by rank.
  assert.deepStrictEqual(applySmartCutoff(hits, CFG).map((h) => h.id), ["kw", "s1", "s2"]);
});

test("max cap: a flat curve degrades to the N best, not the whole library", () => {
  const hits = Array.from({ length: 50 }, (_, i) => hit(`h${i}`, 0.63 - i * 0.0001));
  const out = applySmartCutoff(hits, CFG);
  assert.strictEqual(out.length, CFG.smartMaxResults);
  assert.strictEqual(out[0].id, "h0");
});

test("bounds: fewer hits than the floor, and empty input", () => {
  assert.strictEqual(applySmartCutoff([hit("a", 0.6), hit("b", 0.4)], CFG).length, 2);
  assert.deepStrictEqual(applySmartCutoff([], CFG), []);
});

test("input is not mutated", () => {
  const hits = [hit("a", 0.9), hit("b", 0.1)];
  applySmartCutoff(hits, CFG);
  assert.strictEqual(hits.length, 2);
});

// ---------------------------------------------------------------------------
// Layer 2: the /search route wiring.
// ---------------------------------------------------------------------------
function stub(relPath, exports) {
  const abs = require.resolve(relPath);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

// 30 hits, scores descending 1.0, 0.66, then a flat band far below the top.
const FAKE_HITS = [
  { path: "kw.jpg", _rankingScore: 1.0, taken_at: "2020-01-01T00:00:00.000Z" },
  { path: "real.jpg", _rankingScore: 0.66, taken_at: "2024-01-01T00:00:00.000Z" },
  ...Array.from({ length: 28 }, (_, i) => ({
    path: `junk${i}.jpg`,
    _rankingScore: 0.63 - i * 0.0001,
    taken_at: `20${10 + (i % 10)}-01-01T00:00:00.000Z`,
  })),
];

let lastSearch = null;
stub("../src/lib/meili", {
  init: async () => {},
  search: async (query, opts) => {
    lastSearch = { query, opts };
    return { hits: FAKE_HITS.slice(), estimatedTotalHits: 9999 };
  },
});
stub("../src/lib/embedder", {
  embedImage: async () => [],
  embedText: async () => [0, 1], // query embedding succeeds → hybrid engages
  load: async () => {},
});

const express = require("express");
const config = require("../src/lib/config");
const { MANUAL_SORT_MAX } = require("../src/lib/search-sort");
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
  return r.json();
}

test("route: smartCutoff trims the full working set and totals honestly", async () => {
  const saved = [config.smartMinResults, config.smartMaxResults];
  [config.smartMinResults, config.smartMaxResults] = [5, 200];
  try {
    lastSearch = null;
    const r = await search({ query: "airplane", semanticRatio: 0.6, smartCutoff: true, limit: 3, offset: 0 });
    // One full fetch, not the caller's page size.
    assert.strictEqual(lastSearch.opts.limit, MANUAL_SORT_MAX);
    assert.strictEqual(lastSearch.opts.showRankingScore, true);
    // Window (0.02) keeps kw+real; floor 5 backfills by rank → total exactly 5.
    assert.strictEqual(r.total, 5);
    assert.deepStrictEqual(r.results.map((h) => h.path), ["kw.jpg", "real.jpg", "junk0.jpg"]);
    // Paging serves from the SAME trimmed set.
    const p2 = await search({ query: "airplane", semanticRatio: 0.6, smartCutoff: true, limit: 3, offset: 3 });
    assert.deepStrictEqual(p2.results.map((h) => h.path), ["junk1.jpg", "junk2.jpg"]);
  } finally {
    [config.smartMinResults, config.smartMaxResults] = saved;
  }
});

test("route: smartCutoff + date sort = trim first, then newest-first", async () => {
  const saved = [config.smartMinResults, config.smartMaxResults];
  [config.smartMinResults, config.smartMaxResults] = [2, 200];
  try {
    const r = await search({ query: "airplane", semanticRatio: 0.6, smartCutoff: true, sort: "date:desc", limit: 10, offset: 0 });
    // Trimmed to [kw (2020), real (2024)] then date-sorted → real first.
    assert.deepStrictEqual(r.results.map((h) => h.path), ["real.jpg", "kw.jpg"]);
    assert.strictEqual(r.total, 2);
  } finally {
    [config.smartMinResults, config.smartMaxResults] = saved;
  }
});

test("route: keyword path (semanticRatio 0) ignores smartCutoff", async () => {
  lastSearch = null;
  const r = await search({ query: "airplane", semanticRatio: 0, smartCutoff: true, limit: 3, offset: 0 });
  // No hybrid → no working-set fetch; Meili pages natively.
  assert.strictEqual(lastSearch.opts.limit, 3);
  assert.strictEqual(r.total, 9999);
});
