#!/usr/bin/env node
// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Enrichment worker process — the heavy plane, split out of the API process so
 * its CPU-bound work (CLIP inference, the reconcile tree walk) never blocks the
 * API event loop or its /health probe.
 *
 * Runs: the BullMQ enrichment worker (the pipeline per file), the control worker
 * (full/delta/reap actions enqueued by the API or the cron), the reconcile cron,
 * the filesystem watcher, and the liveness/progress heartbeat. Boots even when
 * Redis/MeiliSearch are down and retries lazily. Shares the API's image (overridden
 * container command); coordinates with the API only through Redis.
 */

const path = require("path");
const cron = require("node-cron");
const chokidar = require("chokidar");

const config = require("../lib/config");
const meili = require("../lib/meili");
const queue = require("../lib/queue");
const reconcile = require("../lib/reconcile");
const { startWorker, stopWorker, startControlWorker, stopControlWorker } = require("../lib/worker");
const enrichers = require("../enrichers");
const { MEDIA_FORMAT_REGEXP } = require("../lib/walk-dir");
const { loadExcludes, isExcluded } = require("rpg-config");

const debug = require("debug")("responsive-photo-gallery:worker-main");
const debugErr = require("debug")("responsive-photo-gallery:worker-main:error");
const debugWatch = require("debug")("responsive-photo-gallery:watch");
const debugWatchErr = require("debug")("responsive-photo-gallery:watch:error");
// Errors are operational signals, not opt-in tracing: force the :error namespaces
// on regardless of the DEBUG filter (see bin/server.js for the rationale).
debugErr.enabled = true;
debugWatchErr.enabled = true;
// Liveness/progress heartbeat. Plain info namespace (gated by DEBUG, not
// force-on); the timer only emits while a reconcile is actually in flight.
const debugHeartbeat = require("debug")("responsive-photo-gallery:heartbeat");

function nextReconcileIso() {
  return new Date(Date.now() + config.reconcileIntervalHours * 60 * 60 * 1000).toISOString();
}

/** " [ocr=3 geo=1]" breakdown for the heartbeat when stages have failed, else "". */
function failByStage(p) {
  const byStage = (p && p.failedByStage) || {};
  const parts = Object.entries(byStage).filter(([, n]) => n > 0);
  return parts.length ? ` [${parts.map(([s, n]) => `${s}=${n}`).join(" ")}]` : "";
}

/** Derive a {album, relPath, absPath} file object from an absolute path. */
function fileFromAbs(absPath) {
  const rel = path.relative(config.imagePath, absPath);
  if (!rel || rel.startsWith("..")) return null;
  const relPath = rel.split(path.sep).join("/");
  const album = relPath.includes("/") ? relPath.split("/")[0] : "root";
  return { album, relPath, absPath };
}

async function main() {
  // Best-effort MeiliSearch connect; never fatal (the pipeline re-inits lazily).
  try {
    await meili.init();
  } catch (err) {
    debugErr("MeiliSearch not reachable at boot: %s", err.message);
  }

  // Workers (resilient: the Redis connection retries if the broker is down).
  startWorker();
  startControlWorker();

  // Watch for new/changed images and enqueue them. ignoreInitial avoids a mass
  // enqueue on boot; reconcile handles backfill. Optional: WATCH_ENABLED=false
  // turns it off entirely (rely on the periodic reconcile) on hosts where the
  // inotify watch limit can't be raised for a large library.
  let watcher = null;
  if (config.watchEnabled) {
    const onFile = (absPath) => {
      if (!MEDIA_FORMAT_REGEXP.test(absPath)) return;
      const file = fileFromAbs(absPath);
      if (!file) return;
      // Respect the shared excludes (read fresh — cheap, and the watcher is off in
      // prod). reconcile/reap already inherit exclusion via walkDir.
      if (isExcluded(file.relPath, loadExcludes())) return;
      queue.enqueueFile(file).catch((err) => debugWatchErr("enqueue failed: %s", err.message));
    };
    watcher = chokidar.watch(config.imagePath, {
      ignoreInitial: true,
      awaitWriteFinish: true,
      // Ignore dotfiles by basename. (A path regex would wrongly match a ".." in
      // a relative IMAGE_PATH and ignore the whole tree.)
      ignored: (p) => path.basename(p).startsWith("."),
    });
    watcher.on("add", onFile).on("change", onFile);
    // Never let a watcher error (e.g. inotify ENOSPC) crash the service — log and
    // degrade to the periodic reconcile.
    watcher.on("error", (err) => debugWatchErr("error (continuing on reconcile only): %s", err.message));
  } else {
    debugWatch("disabled (WATCH_ENABLED=false); relying on periodic reconcile");
  }

  // Periodic reconcile. The cron enqueues a control job (the same path API-side
  // triggers use), so the worker's single control consumer serializes it against
  // any in-flight scan — a scan can never double-run.
  let cronTask = null;
  if (config.reconcileIntervalHours > 0) {
    await reconcile.setNextReconcile(nextReconcileIso());
    cronTask = cron.schedule(`0 */${config.reconcileIntervalHours} * * *`, () => {
      // The recurring pass is a stat-gated "delta": only new/changed files get
      // enqueued, so a steady-state library isn't re-hashed end to end every run.
      // A full re-hash is an on-demand admin action.
      queue.enqueueControl({ action: "delta" }).catch((err) => debugErr("cron enqueue failed: %s", err.message));
      reconcile.setNextReconcile(nextReconcileIso());
    });
    debug("reconcile cron: every %dh", config.reconcileIntervalHours);
  } else {
    debug("reconcile cron disabled (SCAN_INTERVAL_HOURS <= 0)");
  }

  debug("worker started | redis %s | concurrency %d", config.redisUrl, config.workerConcurrency);

  // Periodic liveness/progress heartbeat. Only emits while a reconcile is in
  // flight, so idle logs stay quiet; unref'd so it never holds the process open.
  let heartbeatTimer = null;
  if (config.heartbeatIntervalMin > 0) {
    heartbeatTimer = setInterval(async () => {
      try {
        const status = await reconcile.getStatus();
        if (!status.inProgress) return; // quiet when idle
        const q = status.queue;
        const p = status.progress || {};
        if (q) {
          debugHeartbeat(
            "reconcile active: enqueuing=%s active=%d waiting=%d delayed=%d | processed=%d (enriched=%d skipped=%d failed=%d)%s",
            status.enqueuing,
            q.active || 0,
            q.waiting || 0,
            q.delayed || 0,
            p.completed || 0,
            p.enriched || 0,
            p.skipped || 0,
            p.failed || 0,
            failByStage(p)
          );
        } else {
          debugHeartbeat(
            "reconcile active: enqueuing=%s queue=unknown workerActive=%d | processed=%d (enriched=%d skipped=%d failed=%d)%s",
            status.enqueuing,
            p.active || 0,
            p.completed || 0,
            p.enriched || 0,
            p.skipped || 0,
            p.failed || 0,
            failByStage(p)
          );
        }
      } catch (err) {
        debugErr("heartbeat failed: %s", err.message);
      }
    }, config.heartbeatIntervalMin * 60 * 1000);
    heartbeatTimer.unref();
  }

  const shutdown = async () => {
    debug("shutting down...");
    // Backstop: exit even if a close() below hangs (e.g. a wedged broker socket).
    setTimeout(() => process.exit(0), 2000).unref();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (cronTask) cronTask.stop();
    try {
      if (watcher) await watcher.close();
    } catch (_) {
      /* ignore */
    }
    await stopControlWorker();
    await stopWorker();
    for (const e of enrichers) {
      if (typeof e.terminate === "function") await e.terminate();
    }
    await queue.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  debugErr("Fatal startup error: %s", err.message);
  process.exit(1);
});
