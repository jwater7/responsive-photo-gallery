// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// queue.enqueueFile job-id reconciliation. BullMQ's add() is a silent no-op
// while a job with the same id exists in ANY set, including the retained failed
// set (removeOnFail: 1000) — so without reconciliation a file whose job
// exhausted its attempts could never be re-enqueued by any later scan, and a
// force flag aimed at a still-queued job was silently dropped. bullmq/ioredis
// are stubbed via the CJS require cache (injected BEFORE queue.js loads), so
// this runs hermetically with no Redis.
// Run: npm test  (from enrichment/)

const test = require("node:test");
const assert = require("node:assert");

// ---- stub bullmq + ioredis before requiring queue --------------------------
const jobs = new Map(); // jobId -> fake job
const addCalls = [];
const removed = [];

function makeJob(jobId, data, state) {
  return {
    id: jobId,
    data,
    state,
    getState: async () => state,
    remove: async () => {
      removed.push(jobId);
      jobs.delete(jobId);
    },
    updateData: async function (d) {
      this.data = d;
    },
  };
}

class FakeQueue {
  constructor(name) {
    this.name = name;
  }
  async getJob(jobId) {
    return jobs.get(jobId) || null;
  }
  async add(name, data, opts) {
    addCalls.push({ name, data, opts });
    // Mimic BullMQ: an existing job with the same id makes add() a no-op.
    if (jobs.has(opts.jobId)) return jobs.get(opts.jobId);
    const job = makeJob(opts.jobId, data, "waiting");
    jobs.set(opts.jobId, job);
    return job;
  }
}

class FakeRedis {
  constructor() {
    this.status = "ready";
  }
  on() {}
}

const bullmqPath = require.resolve("bullmq");
require.cache[bullmqPath] = { id: bullmqPath, filename: bullmqPath, loaded: true, exports: { Queue: FakeQueue } };
const ioredisPath = require.resolve("ioredis");
require.cache[ioredisPath] = { id: ioredisPath, filename: ioredisPath, loaded: true, exports: FakeRedis };

const queue = require("../src/lib/queue");

const FILE = { album: "trip", relPath: "trip/a.jpg", absPath: "/img/trip/a.jpg" };
const JOB_ID = "file_trip/a.jpg";

function reset() {
  jobs.clear();
  addCalls.length = 0;
  removed.length = 0;
}

test("no prior job → adds with the dedupe jobId and retry options", async () => {
  reset();
  await queue.enqueueFile(FILE);
  assert.strictEqual(addCalls.length, 1);
  assert.strictEqual(addCalls[0].opts.jobId, JOB_ID);
  assert.strictEqual(addCalls[0].opts.attempts, 3);
  assert.strictEqual(addCalls[0].data.force, undefined);
});

test("retained FAILED job is removed so the re-enqueue actually lands", async () => {
  // The trap: attempts exhausted → job kept by removeOnFail → every later
  // enqueue of this path would be a silent no-op.
  reset();
  jobs.set(JOB_ID, makeJob(JOB_ID, { ...FILE }, "failed"));
  await queue.enqueueFile(FILE);
  assert.deepStrictEqual(removed, [JOB_ID]);
  assert.strictEqual(addCalls.length, 1); // fresh job actually added
  assert.strictEqual(jobs.get(JOB_ID).state, "waiting");
});

test("pending job without force + forced enqueue → force folded into job data", async () => {
  // The drop: a force re-scan hitting a file already queued by a delta scan
  // deduped into the non-force job and the force never applied.
  reset();
  jobs.set(JOB_ID, makeJob(JOB_ID, { ...FILE }, "waiting"));
  await queue.enqueueFile(FILE, ["ocr"]);
  assert.strictEqual(addCalls.length, 0); // deduped, no second job
  assert.deepStrictEqual(jobs.get(JOB_ID).data.force, ["ocr"]);
});

test("pending forced job + broader force → forces merge (true wins, arrays union)", async () => {
  reset();
  jobs.set(JOB_ID, makeJob(JOB_ID, { ...FILE, force: ["ocr"] }, "delayed"));
  await queue.enqueueFile(FILE, ["visual"]);
  assert.deepStrictEqual(jobs.get(JOB_ID).data.force, ["ocr", "visual"]);
  await queue.enqueueFile(FILE, true);
  assert.strictEqual(jobs.get(JOB_ID).data.force, true);
});

test("pending job + plain (non-force) enqueue → dedupes with no data churn", async () => {
  reset();
  const prior = makeJob(JOB_ID, { ...FILE }, "waiting");
  jobs.set(JOB_ID, prior);
  const ret = await queue.enqueueFile(FILE);
  assert.strictEqual(ret, prior);
  assert.strictEqual(addCalls.length, 0);
  assert.strictEqual(prior.data.force, undefined);
});

test("mergeForce: true dominates, arrays union + dedupe, both-falsy stays falsy", () => {
  assert.strictEqual(queue.mergeForce(true, ["ocr"]), true);
  assert.strictEqual(queue.mergeForce(["ocr"], true), true);
  assert.deepStrictEqual(queue.mergeForce(["ocr"], ["ocr", "visual"]), ["ocr", "visual"]);
  assert.strictEqual(queue.mergeForce(false, false), false);
  assert.strictEqual(queue.mergeForce(undefined, false), false);
});
