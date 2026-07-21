// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * BullMQ queue for enrichment jobs. One job per file, deduplicated by relative
 * path so re-enqueuing a still-pending file is a no-op. The Redis connection
 * tolerates the broker being down (it retries) so the service boots regardless.
 */

const { Queue } = require("bullmq");
const IORedis = require("ioredis");
const config = require("./config");

const QUEUE_NAME = "enrichment";
// Control plane: full/delta/reap triggers ride this queue so the API process
// (which accepts the trigger) and the worker process (which executes the walk)
// stay decoupled. Concurrency-1 on the consumer side serializes scans.
const CONTROL_QUEUE_NAME = "enrichment-control";

let connection = null;
let queue = null;
let controlQueue = null;

function getConnection() {
  if (!connection) {
    connection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false,
    });
    // Swallow connection errors so a down broker doesn't crash the process;
    // ioredis keeps retrying in the background (resilient boot).
    connection.on("error", () => {});
  }
  return connection;
}

function getQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  return queue;
}

function getControlQueue() {
  if (!controlQueue) controlQueue = new Queue(CONTROL_QUEUE_NAME, { connection: getConnection() });
  return controlQueue;
}

/**
 * Enqueue a control action (full/delta/reap) for the worker to execute. The
 * jobId is keyed by action so a rapid re-trigger of the same action dedupes to a
 * single pending job (the settled non-blocking contract); removeOnComplete frees
 * the id once the action finishes so it can be triggered again. A SCOPED trigger
 * (force and/or a path) gets a distinct jobId suffix so it neither dedupes into a
 * plain scan nor collides with a differently-scoped one (jobIds may not contain
 * ':').
 * @param {{action: "full"|"delta"|"reap", force?: boolean|string[], path?: string|null}} ctrl
 */
async function enqueueControl({ action, force = false, path = null }) {
  const scope = force || path ? `_${scopeTag(force, path)}` : "";
  return getControlQueue().add("control", { action, force, path }, {
    jobId: `control_${action}${scope}`,
    removeOnComplete: true,
    removeOnFail: 100,
  });
}

/** Stable, ':'-free jobId fragment describing a scoped trigger. */
function scopeTag(force, path) {
  const f = force === true ? "all" : Array.isArray(force) ? force.join("-") : "";
  return `${f}@${path || ""}`.replace(/:/g, "_");
}

/** Merge two force specs: `true` wins, arrays union, both-falsy stays falsy. */
function mergeForce(a, b) {
  if (a === true || b === true) return true;
  const list = [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
  return list.length ? list : false;
}

/**
 * Enqueue a file for enrichment.
 * @param {{album: string, relPath: string, absPath: string}} file
 * @param {boolean|string[]} [force] forwarded to the pipeline to bypass the
 *        up-to-date skip for all (`true`) or named enrichers.
 */
async function enqueueFile(file, force = false) {
  const q = getQueue();
  // BullMQ job IDs may not contain ':'. Dedupes concurrent re-enqueues of the
  // same pending file.
  const jobId = `file_${file.relPath.replace(/:/g, "_")}`;

  // add() is a SILENT no-op while a job with this id exists in ANY set —
  // including the retained failed set (removeOnFail keeps the last 1000). Left
  // alone, a file whose job exhausted its attempts could never be re-enqueued
  // by any later scan/watcher/API call until ~1000 newer failures evicted it,
  // and a force flag aimed at a still-queued job would be silently dropped.
  // Reconcile the prior job first.
  const prior = await q.getJob(jobId);
  if (prior) {
    const state = await prior.getState();
    if (state === "failed" || state === "completed") {
      // Finished: remove it so the add() below actually restarts the file with
      // a fresh attempt budget. (Completed jobs are normally already gone via
      // removeOnComplete; failed ones are the retention trap.)
      await prior.remove();
    } else {
      // Still queued/delayed/running: dedupe into it, but fold a new force into
      // the job's data so the worker sees it when the job runs. Limitation: an
      // ACTIVE job already read its data — that run proceeds un-forced and only
      // a later enqueue re-applies the force.
      const merged = mergeForce(prior.data && prior.data.force, force);
      if (merged) await prior.updateData({ ...prior.data, force: merged });
      return prior;
    }
  }

  const data = force ? { ...file, force } : file;
  return q.add("enrich", data, {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    // Remove on completion so a later change to the same path can be re-enqueued
    // (a lingering completed job with the same jobId would otherwise be a no-op).
    // Redundant work is already avoided by the pipeline's hash-keyed skip.
    removeOnComplete: true,
    removeOnFail: 1000,
  });
}

/**
 * Job counts, or null if the broker is unreachable. Never blocks: returns null
 * immediately when not connected (ioredis queues commands forever under
 * maxRetriesPerRequest:null), and races a short timeout as a backstop so
 * GET /status stays responsive while Redis is down.
 */
async function queueStats() {
  if (getConnection().status !== "ready") return null;
  try {
    return await Promise.race([
      getQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1000)),
    ]);
  } catch (_) {
    return null;
  }
}

async function close() {
  try {
    if (queue) await queue.close();
  } catch (_) {
    /* ignore on shutdown */
  }
  try {
    if (controlQueue) await controlQueue.close();
  } catch (_) {
    /* ignore on shutdown */
  }
  try {
    if (connection) await connection.quit();
  } catch (_) {
    /* ignore on shutdown */
  }
}

module.exports = {
  QUEUE_NAME,
  CONTROL_QUEUE_NAME,
  getConnection,
  getQueue,
  getControlQueue,
  enqueueFile,
  enqueueControl,
  mergeForce,
  queueStats,
  close,
};
