// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * BullMQ workers for the enrichment worker process:
 *  - the enrichment worker runs the pipeline for each queued file, and
 *  - the control worker (concurrency 1) executes full/delta/reap actions, so
 *    triggers accepted by the API process run here, off the API event loop.
 *
 * Progress is recorded to Redis (scan-state) so the API's GET /status can read it
 * across the process boundary; the recorders are fire-and-forget so they never
 * throttle job throughput.
 */

const { Worker } = require("bullmq");
const { QUEUE_NAME, CONTROL_QUEUE_NAME } = require("./queue");
const pipeline = require("./pipeline");
const reconcile = require("./reconcile");
const config = require("./config");
const scanState = require("./scan-state");
const configView = require("./config-view");

const debug = require("debug")("responsive-photo-gallery:worker");
const debugErr = require("debug")("responsive-photo-gallery:worker:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

let worker = null;
let controlWorker = null;

function startWorker() {
  if (worker) return worker;

  // Live in-flight gauge survives nothing on a restart, so clear it on boot to
  // avoid drift from jobs that were active when the process last died.
  scanState.bootReset();
  // Publish the worker-owned config so the API's /config (admin panel) shows the
  // worker's real OCR/scan/watcher values instead of guessing the API
  // container's defaults. Read-only report (the worker owns these vars);
  // fire-and-forget.
  scanState.setConfig(configView.workerConfig());

  // Pass connection options (not a shared instance) so BullMQ owns and
  // error-handles its own blocking client instead of leaking raw ioredis errors.
  worker = new Worker(QUEUE_NAME, (job) => pipeline.runFile(job.data), {
    connection: { url: config.redisUrl, maxRetriesPerRequest: null },
    concurrency: config.workerConcurrency,
  });

  worker.on("active", () => scanState.recordStarted());
  worker.on("completed", (job, res) => {
    scanState.recordCompleted(res);
    if (res && res.ran && res.ran.length) {
      debug("%s: ran %s", job.data.relPath, res.ran.join(", "));
    }
  });
  worker.on("failed", (job, err) => {
    scanState.recordFailed();
    debugErr("%s failed: %s", job && job.data && job.data.relPath, err.message);
  });
  // Avoid crashing on transient broker errors.
  worker.on("error", () => {});

  return worker;
}

/**
 * Control worker: serializes (concurrency 1) full/delta/reap actions enqueued by
 * the API process and the reconcile cron, delegating to the single guarded
 * executor in reconcile.runControl (which owns the isEnqueuing/isReaping flag).
 */
function startControlWorker() {
  if (controlWorker) return controlWorker;

  controlWorker = new Worker(CONTROL_QUEUE_NAME, (job) => reconcile.runControl(job.data.action), {
    connection: { url: config.redisUrl, maxRetriesPerRequest: null },
    concurrency: 1,
  });

  controlWorker.on("completed", (job) => debug("control done: %s", job.data && job.data.action));
  controlWorker.on("failed", (job, err) => {
    debugErr("control %s failed: %s", job && job.data && job.data.action, err.message);
  });
  controlWorker.on("error", () => {});

  return controlWorker;
}

async function stopWorker() {
  if (worker) {
    try {
      await worker.close();
    } catch (_) {
      /* ignore on shutdown */
    }
    worker = null;
  }
}

async function stopControlWorker() {
  if (controlWorker) {
    try {
      await controlWorker.close();
    } catch (_) {
      /* ignore on shutdown */
    }
    controlWorker = null;
  }
}

module.exports = { startWorker, stopWorker, startControlWorker, stopControlWorker };
