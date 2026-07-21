// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// Regression test for THE EXACT ISSUE: Meili's `userProvided` `image` embedder
// fails the ENTIRE documentAdditionOrUpdate task for any doc that has no stored
// vector unless the write opts out with `_vectors:{image:null}`. That silently
// discarded every geo/ocr/caption write to not-yet-embedded docs, freezing ~60k
// docs at old versions with no map cells (the failed-task incident).
//
// Why a unit test can't catch it: the failure is in Meili's ASYNC task
// processing, and our `updateFields` awaits only the task ENQUEUE, never its
// terminal status — so `runFile` reported `ran:["geo"]` while the write was
// rejected. So this test does the one thing production doesn't: it drives a real
// Meili configured exactly like prod, submits the update, WAITS for the task, and
// asserts on its terminal status. Without the fix, step (A) fails the task; with
// the opt-out our pipeline now emits, step (B) succeeds and the fields land; step
// (C) proves we never wipe a real vector.
//
// Gated like the other integration tests (video-meta's `{ skip: !hasFfmpeg }`):
// skipped when Meili isn't reachable (e.g. `npm test` on a laptop). Runs in the
// container / CI where MEILI_HOST_URL points at a live Meili.
// Run: npm test  (from enrichment/, with Meili reachable)

const test = require("node:test");
const assert = require("node:assert");

const config = require("../src/lib/config");
const { needsEmbedOptOut } = require("../src/lib/pipeline");

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

/** Submit and WAIT for a Meili task to settle; returns the terminal task object
 *  (status "succeeded" | "failed"). This waiting step is exactly what the
 *  production write path omits, which is why the bug stayed silent. */
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
const IDX = `test_embed_optout_${Date.now()}`;

async function setupIndex() {
  // Mirror meili.init(): experimental vector store + a userProvided `image`
  // embedder — the exact config that makes vector-less writes fail.
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

test("Meili userProvided embedder: vector-less partial update is rejected; the opt-out fixes it", async (t) => {
  if (!(await reachable())) return t.skip(`Meili not reachable at ${BASE}`);
  await setupIndex();
  try {
    // (A) Reproduce the bug: a geo-style partial update with NO vector on a doc
    // that has none. Meili must FAIL the whole task with vector_embedding_error.
    const bug = await waitTask(
      (await req("PUT", `/indexes/${IDX}/documents`, [{ hash: "a", geo_version: 4, cell_r1: "81abc" }])).taskUid
    );
    assert.strictEqual(bug.status, "failed", "vector-less write should fail (this is the bug)");
    assert.strictEqual(bug.error && bug.error.code, "vector_embedding_error");

    // (B) The fix: our pipeline's needsEmbedOptOut adds `_vectors:{image:null}` for
    // a not-yet-embedded doc. Build the write the same way runFile now does.
    const update = { hash: "a", geo_version: 4, cell_r1: "81abc" };
    assert.strictEqual(needsEmbedOptOut(update, null), true, "guard must opt this write out");
    update._vectors = { [config.embedderName]: null };

    const fixed = await waitTask((await req("PUT", `/indexes/${IDX}/documents`, [update])).taskUid);
    assert.strictEqual(fixed.status, "succeeded", "opt-out write must succeed");

    const doc = await req("GET", `/indexes/${IDX}/documents/a`);
    assert.strictEqual(doc.geo_version, 4, "geo fields must actually land");
    assert.strictEqual(doc.cell_r1, "81abc");
  } finally {
    await teardownIndex();
  }
});

test("Meili userProvided embedder: a real vector survives a later vector-less update (no wipe)", async (t) => {
  if (!(await reachable())) return t.skip(`Meili not reachable at ${BASE}`);
  await setupIndex();
  try {
    // Seed an embedded doc with a real vector (what `visual` writes).
    const vec = Array.from({ length: config.embedDimensions }, () => 0.01);
    const seeded = await waitTask(
      (await req("PUT", `/indexes/${IDX}/documents`, [
        { hash: "b", embedded: true, _vectors: { [config.embedderName]: vec } },
      ])).taskUid
    );
    assert.strictEqual(seeded.status, "succeeded");

    // A later geo write to the embedded doc: the guard must NOT opt out (that
    // would send null and wipe the vector). runFile omits _vectors, Meili keeps
    // the stored one.
    const update = { hash: "b", geo_version: 4 };
    assert.strictEqual(needsEmbedOptOut(update, { embedded: true }), false, "must not opt out an embedded doc");

    const kept = await waitTask((await req("PUT", `/indexes/${IDX}/documents`, [update])).taskUid);
    assert.strictEqual(kept.status, "succeeded", "partial update on an embedded doc must succeed");

    const doc = await req("GET", `/indexes/${IDX}/documents/b?retrieveVectors=true`);
    assert.strictEqual(doc.geo_version, 4);
    assert.ok(
      doc._vectors && doc._vectors[config.embedderName] && doc._vectors[config.embedderName].embeddings,
      "the real vector must still be present (not wiped)"
    );
  } finally {
    await teardownIndex();
  }
});
