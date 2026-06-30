// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Reconcile = walk the image tree and enqueue every file. Enrichment itself
 * (and the delta skip) happens in the worker/pipeline, so enqueueing is cheap
 * and non-blocking. Also owns the status snapshot for GET /api/v1/status.
 */

const path = require("path");

const walkDir = require("./walk-dir");
const config = require("./config");
const meili = require("./meili");
const { fileSize, fileMtime } = require("./hash");
const { enqueueFile, enqueueControl, queueStats } = require("./queue");
const scanState = require("./scan-state");
const { normalize, isExcluded } = require("rpg-config");

const debug = require("debug")("responsive-photo-gallery:reconcile");
const debugErr = require("debug")("responsive-photo-gallery:reconcile:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

/** Has the on-disk file gone untouched since we indexed it? Compares size+mtime
 *  (cheap stat, no content read) against the stored stats for any of the path's
 *  docs. Uses the same helpers as the pipeline so the representations match. */
function fileUnchanged(absPath, entries) {
  const size = fileSize(absPath);
  const mtime = fileMtime(absPath);
  return entries.some((e) => e.file_size === size && e.last_modified === mtime);
}

/**
 * Walk the image tree and enqueue files for enrichment.
 *
 * - "full"  (UI button): enqueue every file; the worker hashes each and skips
 *   ones already up to date. Re-reads the whole library off disk — the thorough
 *   integrity pass (catches content edits that kept the same size+mtime).
 * - "delta" (daily cron): pre-filter by a cheap stat (size+mtime) against the
 *   indexed docs and enqueue only new/changed files — so a steady-state library
 *   isn't re-hashed (re-read) end to end every day. A heuristic: it can't see a
 *   content change that preserved both size and mtime (that's what "full" is
 *   for). If the index can't be read, it falls back to a full enqueue rather
 *   than silently skipping everything.
 */
async function enqueueAll(type = "full", { force = false, path = null } = {}) {
  // New scan session: zero the per-session progress totals (the live `active`
  // gauge and last-completion time are preserved).
  await scanState.reset();

  // Optional path scope (album / subtree / single file): reuse the excludes
  // directory-prefix matcher to keep only in-scope files. normalize canonicalizes
  // to the stored POSIX form and strips any '.'/'..' so it can't traverse.
  const scopePath = path ? normalize([path])[0] || null : null;
  let files = walkDir(config.imagePath);
  if (scopePath) files = files.filter((f) => isExcluded(f.relPath, [scopePath]));

  // The delta pre-filter skips up-to-date files BEFORE they reach the pipeline
  // (where the force bypass lives), so a forced scan must enqueue every in-scope
  // file regardless of stat.
  const statGated = type === "delta" && !force;
  let known = null;
  if (statGated) {
    try {
      known = await meili.allDocStats();
    } catch (err) {
      debugErr("delta: could not read existing docs (%s); falling back to full", err.message);
      known = null; // safe degrade: enqueue everything rather than skip silently
    }
  }

  let enqueued = 0;
  let skipped = 0;
  for (const file of files) {
    if (known) {
      const entries = known.get(file.relPath);
      if (entries && entries.length && fileUnchanged(file.absPath, entries)) {
        skipped++;
        continue;
      }
    }
    await enqueueFile(file, force); // throws if the broker is down -> surfaced to caller
    enqueued++;
  }

  await scanState.setLastScan({
    type,
    force,
    path: scopePath,
    enqueued,
    skipped,
    at: new Date().toISOString(),
  });
  if (statGated) {
    debug("delta enqueue: %d new/changed, %d unchanged skipped", enqueued, skipped);
  } else {
    debug("%s enqueue: %d files%s", type, enqueued, scopePath ? ` (scope: ${scopePath})` : "");
  }
  return enqueued;
}

/**
 * Accept a reconcile trigger (API side). Non-blocking: returns immediately with
 * `started`/`running` (the settled non-blocking contract). The actual walk runs
 * in the worker process — we enqueue a control job rather than execute here, so
 * the API event loop never does the scan. `type` is "full" (re-hash everything)
 * or "delta" (stat-gated; the cron default).
 */
async function triggerReconcile(type = "full", { force = false, path = null } = {}) {
  // Best-effort "already running" report for the user; the real mutual exclusion
  // is the control queue's per-action jobId dedup + the consumer's concurrency-1.
  if (await scanState.getFlag("isEnqueuing")) return { started: false, status: "running" };
  await enqueueControl({ action: type, force, path });
  return { started: true, status: "started" };
}

function setNextReconcile(iso) {
  return scanState.setNextReconcile(iso);
}

/**
 * Worker-side executor for a control job (full/delta/reap). The single guarded
 * path both the API-triggered control jobs AND the worker's reconcile cron funnel
 * through (the cron enqueues a control job too), so a scan can never double-run:
 * the control consumer is concurrency-1, and the isEnqueuing/isReaping flag is set
 * here for the duration so GET /status reports it across the process boundary.
 */
async function runControl(action, { force = false, path = null } = {}) {
  if (action === "reap") {
    await scanState.setReaping(true);
    try {
      await reap();
    } finally {
      await scanState.setReaping(false);
    }
    return;
  }
  await scanState.setEnqueuing(true);
  try {
    await enqueueAll(action, { force, path });
  } finally {
    await scanState.setEnqueuing(false);
  }
}

/**
 * Reaping pass: delete index docs that no longer correspond to a file on disk.
 * Reconcile only ever adds/updates, so without this the index grows stale —
 * deleted files linger forever, and an edited file leaves its old content-hash
 * doc orphaned under the same path. Two cases:
 *  - orphaned path: every doc whose `path` is gone from disk (a deleted file).
 *  - superseded hash: a still-present path with >1 doc (an edit produced a new
 *    content-hash doc and left the old one behind) — keep the doc whose stored
 *    size+mtime matches the file on disk, reap its siblings.
 *
 * Reaping only ever DELETES, and only against a successfully-read tree. walkDir
 * swallows readdir errors (e.g. an unmounted IMAGE_PATH) and returns fewer/zero
 * files, so a glitchy mount could look like "everything was deleted". Guard:
 * refuse to reap when the walk found zero files. The superseded case is also
 * conservative — if NO doc's stat matches disk (the delta blind spot: an edit
 * that preserved both size and mtime), we can't tell which is current without
 * re-hashing, so we keep them all rather than guess.
 *
 * Scoped to the Meili index only; the gallery's sprite/thumb cache self-heals
 * via its own dir-fingerprint and isn't touched here.
 */
async function reap() {
  const files = walkDir(config.imagePath);
  if (files.length === 0) {
    // Almost always a mount glitch (walkDir swallows readdir errors), not a
    // genuinely empty library — refuse to wipe the index.
    debugErr("reap: walk found 0 files; refusing to reap against an empty tree (mount glitch?)");
    const summary = {
      reaped: 0,
      orphanPaths: 0,
      supersededHashes: 0,
      docs: 0,
      skipped: "empty-walk",
      at: new Date().toISOString(),
    };
    await scanState.setLastReap(summary);
    return summary;
  }

  const present = new Set(files.map((f) => f.relPath));
  const docs = await meili.allDocRefs();

  // Group docs by path so superseded hashes (same path, different content) are
  // handled together.
  const byPath = new Map();
  for (const d of docs) {
    if (!d.path) continue; // no path -> can't verify against disk; leave it
    let arr = byPath.get(d.path);
    if (!arr) {
      arr = [];
      byPath.set(d.path, arr);
    }
    arr.push(d);
  }

  const toDelete = [];
  let orphanPaths = 0;
  let supersededHashes = 0;
  for (const [docPath, group] of byPath) {
    if (!present.has(docPath)) {
      // File gone from disk -> reap every doc for it.
      orphanPaths++;
      for (const d of group) toDelete.push(d.hash);
      continue;
    }
    if (group.length <= 1) continue; // single current doc, keep it
    // Still-present path with multiple docs: keep the one(s) matching disk.
    const abs = path.join(config.imagePath, docPath);
    const size = fileSize(abs);
    const mtime = fileMtime(abs);
    const current = group.filter((d) => d.file_size === size && d.last_modified === mtime);
    if (current.length === 0) continue; // can't identify the current one; keep all
    for (const d of group) {
      if (!current.includes(d)) {
        toDelete.push(d.hash);
        supersededHashes++;
      }
    }
  }

  await meili.deleteDocs(toDelete);

  const summary = {
    reaped: toDelete.length,
    orphanPaths,
    supersededHashes,
    docs: docs.length,
    skipped: null,
    at: new Date().toISOString(),
  };
  await scanState.setLastReap(summary);
  debug(
    "reap: removed %d docs (%d orphaned paths, %d superseded hashes) of %d",
    toDelete.length,
    orphanPaths,
    supersededHashes,
    docs.length
  );
  return summary;
}

/**
 * Accept a reaping trigger (API side). Non-blocking (same contract as
 * triggerReconcile): enqueue a control job; the worker runs the reap.
 */
async function triggerReap() {
  if (await scanState.getFlag("isReaping")) return { started: false, status: "running" };
  await enqueueControl({ action: "reap" });
  return { started: true, status: "started" };
}

/**
 * Non-blocking status snapshot. Same response shape as before the worker split,
 * but progress + scan flags are now read from Redis (written by the worker
 * process) rather than in-process memory. Reads race a short timeout and degrade
 * to a best-effort empty snapshot (see scan-state.js), so a broker blip yields a
 * best-effort status, never a 5xx.
 */
async function getStatus() {
  const counts = await queueStats();
  const prog = await scanState.progressSnapshot();
  const scan = await scanState.scanSnapshot();

  // queueStats() returns null when the broker can't be read. Treat that as
  // "unknown", never as idle: don't emit a nextScheduledScan, and fall back to the
  // worker's live `active` gauge to tell whether work is still in flight. (With the
  // worker out of the API process, event-loop starvation no longer causes this —
  // so it now signals a genuine broker outage.)
  if (!counts) {
    return {
      inProgress: scan.isEnqueuing || scan.isReaping || prog.active > 0,
      enqueuing: scan.isEnqueuing,
      reaping: scan.isReaping,
      queue: null,
      queueStatus: "unknown",
      progress: prog,
      lastScan: scan.lastScan,
      lastReap: scan.lastReap,
      nextScheduledScan: null,
    };
  }

  const active = counts.active || 0;
  const waiting = (counts.waiting || 0) + (counts.delayed || 0);
  const busy = scan.isEnqueuing || scan.isReaping || active > 0 || waiting > 0;

  return {
    inProgress: busy,
    enqueuing: scan.isEnqueuing,
    reaping: scan.isReaping,
    queue: counts,
    queueStatus: "ok",
    progress: prog,
    lastScan: scan.lastScan,
    lastReap: scan.lastReap,
    nextScheduledScan: busy ? null : scan.nextReconcile,
  };
}

module.exports = {
  enqueueAll,
  triggerReconcile,
  reap,
  triggerReap,
  runControl,
  setNextReconcile,
  getStatus,
};
