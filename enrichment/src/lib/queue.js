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
 * the id once the action finishes so it can be triggered again.
 * @param {{action: "full"|"delta"|"reap"}} ctrl
 */
async function enqueueControl({ action }) {
  return getControlQueue().add("control", { action }, {
    jobId: `control_${action}`,
    removeOnComplete: true,
    removeOnFail: 100,
  });
}

/**
 * Enqueue a file for enrichment.
 * @param {{album: string, relPath: string, absPath: string}} file
 */
async function enqueueFile(file) {
  return getQueue().add("enrich", file, {
    // BullMQ job IDs may not contain ':'. Dedupes concurrent re-enqueues of the
    // same pending file.
    jobId: `file_${file.relPath.replace(/:/g, "_")}`,
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
  queueStats,
  close,
};
