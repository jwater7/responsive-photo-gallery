// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Redis-backed enrichment progress + scan/reap state, shared across the API and
 * worker processes (the worker writes, the API's GET /status reads). Replaces the
 * former in-process progress.js and reconcile.js `state` object now that the
 * worker runs in its own process.
 *
 * Two stores, both reusing the queue's ioredis client (no extra connection):
 *  - progress (hash `enrichment:progress`): session totals `completed`/`enriched`/
 *    `skipped` plus the live `active` gauge and `lastCompletedAt`. The worker's
 *    job events drive these; writes are fire-and-forget so they never throttle job
 *    throughput, which makes the counters eventually-consistent (Meili remains the
 *    source of truth). `active` is reset to 0 on worker boot so a crash mid-job
 *    can't leave a stale in-flight count.
 *  - scan (hash `enrichment:scan`): the cross-process flags + summaries the API
 *    needs — `isEnqueuing`/`isReaping`, `nextReconcile`, `lastScan`, `lastReap`.
 *
 * Reads race a short timeout (like queue.queueStats) so a down/slow broker never
 * blocks GET /status; on failure they degrade to a best-effort empty snapshot,
 * never throw.
 */

const queue = require("./queue");

const PROGRESS_KEY = "enrichment:progress";
const SCAN_KEY = "enrichment:scan";
const CONFIG_KEY = "enrichment:config";
const READ_TIMEOUT_MS = 1000;

function conn() {
  return queue.getConnection();
}

// Race a Redis read against a short timeout so GET /status stays responsive even
// when the broker is down (ioredis queues commands forever under
// maxRetriesPerRequest:null). Mirrors queue.queueStats().
function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), READ_TIMEOUT_MS)),
  ]);
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

// --- progress counters (worker writes, fire-and-forget) --------------------

/** Zero the per-session totals at scan start; preserve the live `active` gauge
 *  and `lastCompletedAt` (same semantics as the former progress.reset()). Also
 *  clears the dynamic per-stage failure keys (`failed:<stage>`) from any prior
 *  scan so the counts are per-session. */
async function reset() {
  try {
    await conn().hset(PROGRESS_KEY, "completed", 0, "enriched", 0, "skipped", 0, "failed", 0);
    const stale = (await conn().hkeys(PROGRESS_KEY)).filter((k) => k.startsWith("failed:"));
    if (stale.length) await conn().hdel(PROGRESS_KEY, ...stale);
  } catch (_) {
    /* fire-and-forget */
  }
}

/** Clear the live in-flight gauge on worker boot so a crash mid-job (which skips
 *  the matching recordCompleted/recordFailed) can't leave `active` drifted. */
function bootReset() {
  return conn().hset(PROGRESS_KEY, "active", 0).catch(() => {});
}

function recordStarted() {
  return conn().hincrby(PROGRESS_KEY, "active", 1).catch(() => {});
}

function recordCompleted(res) {
  const ran = res && Array.isArray(res.ran) && res.ran.length > 0;
  const failed = res && Array.isArray(res.failed) ? res.failed : [];
  const m = conn()
    .multi()
    .hincrby(PROGRESS_KEY, "active", -1)
    .hincrby(PROGRESS_KEY, "completed", 1)
    .hincrby(PROGRESS_KEY, ran ? "enriched" : "skipped", 1)
    .hset(PROGRESS_KEY, "lastCompletedAt", new Date().toISOString());
  // Per-stage failure tally for this scan session (e.g. `failed:ocr`), plus a
  // doc-level `failed` total (docs with ≥1 failed stage). Lets /status and the
  // heartbeat surface broken enrichments, not just empty ones. See TODO #9.
  if (failed.length) {
    m.hincrby(PROGRESS_KEY, "failed", 1);
    for (const stage of failed) m.hincrby(PROGRESS_KEY, `failed:${stage}`, 1);
  }
  return m.exec().catch(() => {});
}

function recordFailed() {
  return conn().hincrby(PROGRESS_KEY, "active", -1).catch(() => {});
}

async function progressSnapshot() {
  try {
    const h = (await withTimeout(conn().hgetall(PROGRESS_KEY))) || {};
    const failedByStage = {};
    for (const [k, v] of Object.entries(h)) {
      if (k.startsWith("failed:")) failedByStage[k.slice("failed:".length)] = toInt(v);
    }
    return {
      completed: toInt(h.completed),
      enriched: toInt(h.enriched),
      skipped: toInt(h.skipped),
      failed: toInt(h.failed),
      failedByStage,
      active: Math.max(0, toInt(h.active)), // guard against transient negative drift
      lastCompletedAt: h.lastCompletedAt || null,
    };
  } catch (_) {
    return { completed: 0, enriched: 0, skipped: 0, failed: 0, failedByStage: {}, active: 0, lastCompletedAt: null };
  }
}

// --- scan/reap state (worker writes flags+summaries, API reads) ------------

function setEnqueuing(v) {
  return conn().hset(SCAN_KEY, "isEnqueuing", v ? "1" : "0").catch(() => {});
}

function setReaping(v) {
  return conn().hset(SCAN_KEY, "isReaping", v ? "1" : "0").catch(() => {});
}

/** Cheap single-flag read for the non-blocking trigger guard. Degrades to false
 *  (treat as "not running", allow the trigger) if Redis is unreadable. */
async function getFlag(field) {
  try {
    return (await withTimeout(conn().hget(SCAN_KEY, field))) === "1";
  } catch (_) {
    return false;
  }
}

function setNextReconcile(iso) {
  return conn().hset(SCAN_KEY, "nextReconcile", iso || "").catch(() => {});
}

function setLastScan(obj) {
  return conn().hset(SCAN_KEY, "lastScan", JSON.stringify(obj)).catch(() => {});
}

function setLastReap(obj) {
  return conn().hset(SCAN_KEY, "lastReap", JSON.stringify(obj)).catch(() => {});
}

function parseJson(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

async function scanSnapshot() {
  try {
    const h = (await withTimeout(conn().hgetall(SCAN_KEY))) || {};
    return {
      isEnqueuing: h.isEnqueuing === "1",
      isReaping: h.isReaping === "1",
      nextReconcile: h.nextReconcile || null,
      lastScan: parseJson(h.lastScan),
      lastReap: parseJson(h.lastReap),
    };
  } catch (_) {
    return { isEnqueuing: false, isReaping: false, nextReconcile: null, lastScan: null, lastReap: null };
  }
}

// --- effective config (worker publishes on boot, API reads) ----------------
// The worker carries the OCR_*/tag/scan/watcher env that actually drives
// processing, so it is the source of truth; the API container may not have those
// vars set (e.g. WATCH_ENABLED on the worker only). Piggybacks on this same
// worker→Redis→API channel as the progress/scan state. Plain JSON string key
// (read/written whole), written once at worker boot.

function setConfig(categories) {
  return conn()
    .set(CONFIG_KEY, JSON.stringify({ at: new Date().toISOString(), source: "worker", categories }))
    .catch(() => {});
}

async function getConfig() {
  try {
    return parseJson(await withTimeout(conn().get(CONFIG_KEY)));
  } catch (_) {
    return null;
  }
}

module.exports = {
  reset,
  bootReset,
  recordStarted,
  recordCompleted,
  recordFailed,
  progressSnapshot,
  setEnqueuing,
  setReaping,
  getFlag,
  setNextReconcile,
  setLastScan,
  setLastReap,
  scanSnapshot,
  setConfig,
  getConfig,
};
