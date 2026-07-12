// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// Contract test for the video multi-vector design (add-video-embeddings-and-
// search-filter D1): the visual enricher stores a video's embedding as SEVERAL
// vectors under the one userProvided `image` embedder (per-keyframe + a
// metadata-text vector) and relies on Meili to (a) accept the array form,
// (b) return a shape pipeline.hasEmbedding recognizes (so embeddingLost won't
// perpetually re-embed videos), and (c) rank by the BEST-matching vector
// (max-sim) — the whole point of storing frames individually instead of
// mean-pooling.
//
// Proven against v1.47 by the change's spike; kept as a test because this
// plane's failure mode is Meili silently failing the async task (see
// embed-optout-meili.test.js) and a Meili upgrade could regress any of the
// three points without a unit test noticing.
//
// Gated like the other integration tests: skipped when Meili isn't reachable
// (e.g. `npm test` on a laptop). Runs in the container / CI where
// MEILI_HOST_URL points at a live Meili.

const test = require("node:test");
const assert = require("node:assert");

const config = require("../src/lib/config");
const { hasEmbedding } = require("../src/lib/pipeline");

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

// A unique throwaway index per run so we never touch the real `docs` index.
const IDX = `test_multi_vector_${Date.now()}`;

/** Unit basis vector along axis i (embedDimensions long). */
function unit(i) {
  const v = new Array(config.embedDimensions).fill(0);
  v[i] = 1;
  return v;
}

async function setupIndex() {
  await req("PATCH", "/experimental-features", { vectorStore: true }).catch(() => {});
  await waitTask((await req("POST", "/indexes", { uid: IDX, primaryKey: "hash" })).taskUid);
  await waitTask(
    (await req("PATCH", `/indexes/${IDX}/settings`, {
      embedders: { [config.embedderName]: { source: "userProvided", dimensions: config.embedDimensions } },
    })).taskUid
  );
}

async function teardownIndex() {
  await req("DELETE", `/indexes/${IDX}`).catch(() => {});
}

test("Meili multi-vector: write accepted, hasEmbedding-compatible shape, max-sim ranking", async (t) => {
  if (!(await reachable())) return t.skip(`Meili not reachable at ${BASE}`);
  await setupIndex();
  try {
    // (a) A video-style doc: 3 "keyframe" vectors + 1 "text" vector under the
    // single `image` embedder, plus a single-vector control doc whose one
    // vector has cosine 0.6 against the query below (norm 1: 0.6² + 0.8² = 1).
    const control = unit(1).map((x, i) => (i === 1 ? 0.6 : i === 4 ? 0.8 : 0));
    const write = await waitTask(
      (await req("PUT", `/indexes/${IDX}/documents`, [
        { hash: "multi", _vectors: { [config.embedderName]: [unit(0), unit(1), unit(2), unit(3)] } },
        { hash: "single", _vectors: { [config.embedderName]: control } },
      ])).taskUid
    );
    assert.strictEqual(write.status, "succeeded", "multi-vector write must not fail the task");

    // (b) retrieveVectors returns { embeddings: [[...]×4], regenerate } — the
    // shape hasEmbedding parses, so embeddingLost won't re-trigger for videos.
    const doc = await req("GET", `/indexes/${IDX}/documents/multi?retrieveVectors=true`);
    assert.ok(hasEmbedding(doc, config.embedderName), "hasEmbedding must accept the multi-vector shape");
    assert.strictEqual(doc._vectors[config.embedderName].embeddings.length, 4, "all 4 vectors stored");

    // (c) Max-sim: query along axis 1. multi's best vector (unit(1)) has cos
    // 1.0 → score 1.0; the control has cos 0.6 → score 0.8. Mean-pooling
    // multi's vectors would score 0.625 and LOSE — max-sim must win.
    const res = await req("POST", `/indexes/${IDX}/search`, {
      vector: unit(1),
      hybrid: { semanticRatio: 1.0, embedder: config.embedderName },
      showRankingScore: true,
      limit: 10,
    });
    const order = res.hits.map((h) => h.hash);
    assert.deepStrictEqual(order, ["multi", "single"], "multi-vector doc must rank by its BEST vector");
    assert.ok(res.hits[0]._rankingScore > 0.99, "best-vector score, not a pooled/averaged one");
  } finally {
    await teardownIndex();
  }
});
