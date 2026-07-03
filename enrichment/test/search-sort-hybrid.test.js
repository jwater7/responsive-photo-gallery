// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// Regression test for THE EXACT ISSUE: on the search page, choosing "Newest"
// (a date sort) left photos in what looked like a RANDOM order whenever "Smart"
// (semantic/hybrid) search was on.
//
// Root cause: MeiliSearch SILENTLY IGNORES the `sort` parameter for a hybrid /
// vector search — it always returns hits ordered by descending semantic
// `_rankingScore`, never by the requested `sort`. The keyword path was never
// broken (Meili honors `sort` there), which is why "Newest" worked with Smart
// OFF but not ON.
//
// The fix: for a hybrid search with a date sort, the /search handler no longer
// relies on Meili's ignored `sort`. It fetches the score-thresholded match set
// and orders it itself with `sortHitsByKeys`, so the smart path produces the SAME
// date order as the keyword path.
//
// This file has two layers:
//   1. Pure unit tests for `sortHitsByKeys` (always run) — the ordering logic,
//      including Meili's "missing key sorts last" semantics the fix replicates.
//   2. A Meili integration test (skipped when Meili isn't reachable, like
//      embed-optout-meili) that seeds docs whose semantic-score order is NOT
//      their date order, then proves: keyword+sort is date-ordered; raw
//      hybrid+sort is NOT (the bug); and hybrid + `sortHitsByKeys` (the fix)
//      matches the keyword order.
// Run: npm test  (from enrichment/; layer 2 needs Meili reachable)

const test = require("node:test");
const assert = require("node:assert");

const config = require("../src/lib/config");
const { MANUAL_SORT_MAX, sortHitsByKeys } = require("../src/lib/search-sort");

// Mirror routes/enrichment-api.js SORT_OPTIONS["date:desc"].
const DATE_SORT = ["taken_at:desc", "last_modified:desc"];

// ---------------------------------------------------------------------------
// Layer 1: sortHitsByKeys — pure, no Meili.
// ---------------------------------------------------------------------------

test("sortHitsByKeys: orders by the primary date key, descending", () => {
  const hits = [
    { id: "b", taken_at: "2022-01-01T00:00:00.000Z" },
    { id: "a", taken_at: "2024-01-01T00:00:00.000Z" },
    { id: "c", taken_at: "2020-01-01T00:00:00.000Z" },
  ];
  assert.deepStrictEqual(sortHitsByKeys(hits, DATE_SORT).map((h) => h.id), ["a", "b", "c"]);
});

test("sortHitsByKeys: a doc missing the primary key sorts LAST, regardless of direction", () => {
  // `nodate` has the NEWEST last_modified but no taken_at — it must still land
  // last under date:desc, matching Meili's native sort of the keyword path.
  const hits = [
    { id: "nodate", last_modified: "2030-01-01T00:00:00.000Z" },
    { id: "new", taken_at: "2024-01-01T00:00:00.000Z", last_modified: "2024-01-01T00:00:00.000Z" },
    { id: "old", taken_at: "2020-01-01T00:00:00.000Z", last_modified: "2020-01-01T00:00:00.000Z" },
  ];
  assert.deepStrictEqual(sortHitsByKeys(hits, DATE_SORT).map((h) => h.id), ["new", "old", "nodate"]);
  // ...and last under date:asc too (missing is always last, not "smallest").
  const asc = ["taken_at:asc", "last_modified:asc"];
  assert.deepStrictEqual(sortHitsByKeys(hits, asc).map((h) => h.id), ["old", "new", "nodate"]);
});

test("sortHitsByKeys: later keys break ties, including among docs missing the primary key", () => {
  const hits = [
    { id: "n2", last_modified: "2021-01-01T00:00:00.000Z" }, // both missing taken_at →
    { id: "n1", last_modified: "2023-01-01T00:00:00.000Z" }, // ordered by last_modified desc
    { id: "dated", taken_at: "2019-01-01T00:00:00.000Z", last_modified: "2000-01-01T00:00:00.000Z" },
  ];
  assert.deepStrictEqual(sortHitsByKeys(hits, DATE_SORT).map((h) => h.id), ["dated", "n1", "n2"]);
});

test("sortHitsByKeys: does not mutate its input", () => {
  const hits = [
    { id: "a", taken_at: "2020-01-01T00:00:00.000Z" },
    { id: "b", taken_at: "2024-01-01T00:00:00.000Z" },
  ];
  const before = hits.map((h) => h.id);
  sortHitsByKeys(hits, DATE_SORT);
  assert.deepStrictEqual(hits.map((h) => h.id), before);
});

// ---------------------------------------------------------------------------
// Layer 2: Meili integration — proves the platform behavior and the end-to-end
// fix on a real, isolated index. Gated on reachability like embed-optout-meili.
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

async function waitTask(taskUid) {
  for (let i = 0; i < 100; i++) {
    const t = await fetch(`${BASE}/tasks/${taskUid}`, { headers: AUTH }).then((r) => r.json());
    if (t.status !== "enqueued" && t.status !== "processing") return t;
    await new Promise((s) => setTimeout(s, 100));
  }
  throw new Error(`task ${taskUid} did not settle`);
}

async function req(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.json();
}

const IDX = `test_search_sort_${Date.now()}`;
const EMB = config.embedderName;
const DIM = config.embedDimensions;

// A vector pointing along the first axis by `x` and the second by `y`, padded to
// the embedder's dimension. Cosine similarity to the query [1,0,…] is
// x / hypot(x, y), so a larger `y` (relative to x) ⇒ a lower semantic score.
function vec(x, y) {
  const v = new Array(DIM).fill(0);
  v[0] = x;
  v[1] = y;
  return v;
}

const QUERY_VEC = vec(1, 0); // query direction: pure first-axis
// Every doc shares the searchable text "photo" so the keyword path matches all
// equally — order there comes purely from `sort`. Vectors set the semantic-score
// order. `nodate` has the NEWEST last_modified but NO taken_at, to exercise the
// missing-key-sorts-last rule on both paths.
const DOCS = [
  { hash: "old",    text: "photo", taken_at: "2020-01-01T00:00:00.000Z", last_modified: "2020-01-01T00:00:00.000Z", _vectors: { [EMB]: vec(1, 0.0) } }, // cos 1.000
  { hash: "nodate", text: "photo",                                       last_modified: "2030-01-01T00:00:00.000Z", _vectors: { [EMB]: vec(1, 0.5) } }, // cos 0.894
  { hash: "mid",    text: "photo", taken_at: "2022-01-01T00:00:00.000Z", last_modified: "2022-01-01T00:00:00.000Z", _vectors: { [EMB]: vec(1, 2.0) } }, // cos 0.447
  { hash: "new",    text: "photo", taken_at: "2024-01-01T00:00:00.000Z", last_modified: "2024-01-01T00:00:00.000Z", _vectors: { [EMB]: vec(1, 9.0) } }, // cos 0.110
];
const DATE_DESC = ["new", "mid", "old", "nodate"]; // what "Newest" must produce (missing → last)
const SCORE_DESC = ["old", "nodate", "mid", "new"]; // what Meili produces from semantic score

async function setupIndex() {
  await req("PATCH", "/experimental-features", { vectorStore: true }).catch(() => {});
  await waitTask((await req("POST", "/indexes", { uid: IDX, primaryKey: "hash" })).taskUid);
  await waitTask(
    (await req("PATCH", `/indexes/${IDX}/settings`, {
      // Same knobs prod sets in lib/meili.js: date fields sortable + userProvided
      // `image` embedder so hybrid search works.
      sortableAttributes: ["taken_at", "last_modified"],
      embedders: { [EMB]: { source: "userProvided", dimensions: DIM } },
    })).taskUid
  );
  await waitTask((await req("PUT", `/indexes/${IDX}/documents`, DOCS)).taskUid);
}

async function teardownIndex() {
  await req("DELETE", `/indexes/${IDX}`).catch(() => {});
}

async function search(opts) {
  const r = await req("POST", `/indexes/${IDX}/search`, {
    q: "photo",
    attributesToRetrieve: ["hash", "taken_at", "last_modified"],
    limit: MANUAL_SORT_MAX,
    ...opts,
  });
  assert.ok(r.hits, `search returned no hits array: ${JSON.stringify(r)}`);
  return r.hits;
}

test("keyword search honors date:desc sort (Smart OFF path — never broken)", async (t) => {
  if (!(await reachable())) return t.skip(`Meili not reachable at ${BASE}`);
  await setupIndex();
  try {
    const hits = await search({ sort: DATE_SORT });
    assert.deepStrictEqual(hits.map((h) => h.hash), DATE_DESC);
  } finally {
    await teardownIndex();
  }
});

test("hybrid search IGNORES Meili's sort (the platform bug the fix works around)", async (t) => {
  if (!(await reachable())) return t.skip(`Meili not reachable at ${BASE}`);
  await setupIndex();
  try {
    const hits = await search({
      vector: QUERY_VEC,
      hybrid: { semanticRatio: 1.0, embedder: EMB },
      sort: DATE_SORT, // asked for, but Meili drops it under hybrid
    });
    assert.deepStrictEqual(
      hits.map((h) => h.hash),
      SCORE_DESC,
      "Meili should return semantic-score order despite `sort` (documents WHY we sort server-side)"
    );
  } finally {
    await teardownIndex();
  }
});

test("THE FIX: hybrid fetch + sortHitsByKeys yields the SAME date order as the keyword path", async (t) => {
  if (!(await reachable())) return t.skip(`Meili not reachable at ${BASE}`);
  await setupIndex();
  try {
    // Exactly what the /search handler now does on the smart+date-sort path:
    // fetch the (capped) hybrid match set WITHOUT a Meili sort, then order it
    // ourselves.
    const hits = await search({ vector: QUERY_VEC, hybrid: { semanticRatio: 1.0, embedder: EMB } });
    const sorted = sortHitsByKeys(hits, DATE_SORT);
    assert.deepStrictEqual(sorted.map((h) => h.hash), DATE_DESC, "smart path must be newest-first");

    // ...and it paginates correctly off the sorted list (offset 2, limit 2).
    assert.deepStrictEqual(sorted.slice(2, 4).map((h) => h.hash), ["old", "nodate"]);
  } finally {
    await teardownIndex();
  }
});
