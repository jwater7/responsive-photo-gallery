// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Runs the ordered enricher stages for a single file. Each enricher is
 * idempotent: it is skipped when its output fields already exist for the file's
 * content hash *and* were produced by the current version of that enricher, so
 * re-scans backfill missing fields and regenerate stale ones. One enricher
 * failing does not abort the others.
 */

const meili = require("./meili");
const { computeHash, mimeFor, fileMtime, fileSize } = require("./hash");
const enrichers = require("../enrichers");

// Per-enricher wall time, to see which stage dominates the per-image cost (e.g.
// OCR vs CLIP). Gated by DEBUG like other info-type logs; off by default.
const debugTiming = require("debug")("responsive-photo-gallery:pipeline:timing");
// Stage failures. Force-on like the other `:error` namespaces so a broken/empty
// enrichment is never silent in prod (a thrown enricher used to log on a plain,
// DEBUG-gated namespace and so disappeared). See TODO Enrichment #9.
const debugErr = require("debug")("responsive-photo-gallery:pipeline:error");
debugErr.enabled = true;

function hasAllFields(doc, fields) {
  if (!doc) return false;
  return fields.every((f) => doc[f] !== undefined && doc[f] !== null);
}

/** Per-enricher version stamp field on a doc, e.g. `ocr_version`. */
function versionField(enricher) {
  return `${enricher.name}_version`;
}

/** Per-enricher failure-reason field on a doc, e.g. `ocr_error`. */
function errorField(enricher) {
  return `${enricher.name}_error`;
}

/**
 * True when the existing doc already carries this enricher's output produced by
 * the *current* version — so it can be skipped. Requires the output fields to be
 * present, the last run NOT to have errored, AND the stored version to be at
 * least the enricher's current version. A missing version stamp is read as
 * baseline v1, so a doc indexed before versioning is only reprocessed for
 * enrichers whose version was bumped past 1 (not a blanket re-run of every
 * stage). A recorded `<name>_error` always forces a retry on the next scan. New
 * enrichers are unaffected: their output field is absent, so `hasAllFields`
 * already returns false.
 */
function isCurrent(doc, enricher) {
  if (!hasAllFields(doc, enricher.outputFields)) return false;
  if (doc[errorField(enricher)]) return false; // failed last time → retry
  const want = enricher.version || 1;
  const have = doc[versionField(enricher)] || 1;
  return have >= want;
}

/**
 * Enrich one file: hash it, look up the existing doc, run each applicable
 * enricher whose output is missing, and write a single merged partial update.
 *
 * @param {{album: string, relPath: string, absPath: string}} file
 * @returns {Promise<{hash: string, ran: string[], skipped: string[], failed: string[]}>}
 */
async function runFile(file) {
  await meili.init();

  const hash = await computeHash(file.absPath);
  const existing = await meili.getDoc(hash);

  const update = { hash };
  if (!existing) {
    // Base fields, written once when the document is first created.
    update.album = file.album;
    update.path = file.relPath;
    update.mime_type = mimeFor(file.relPath);
    update.file_size = fileSize(file.absPath);
    update.last_modified = fileMtime(file.absPath);
  } else {
    // Same content hash, so nothing to re-enrich — but the file's stat may have
    // drifted (e.g. an mtime-only touch, or a doc indexed before these fields
    // existed). Refresh the stored size/mtime so the delta scan, which gates on
    // them, stops re-enqueuing this file every pass.
    //
    // Only the doc's CANONICAL path refreshes the stat. A content-addressed doc
    // holds one path + one last_modified, but duplicate copies (same bytes,
    // different path/mtime) all map to this doc. If every copy refreshed, they'd
    // clobber each other's last_modified each scan and the owner would perpetually
    // fail the delta gate (the STAT_MISS churn). Duplicates re-queue regardless
    // (they always miss the path-keyed gate), so a non-owner refresh only adds
    // churn — skip it. A moved/renamed canonical is handled elsewhere: reap drops
    // the now-orphaned doc and the next scan recreates it under a surviving path.
    if (existing.path === file.relPath) {
      const size = fileSize(file.absPath);
      const mtime = fileMtime(file.absPath);
      if (existing.file_size !== size) update.file_size = size;
      if (existing.last_modified !== mtime) update.last_modified = mtime;
    }
  }

  const ran = [];
  const skipped = [];
  const failed = [];

  for (const enricher of enrichers) {
    if (enricher.applies && !enricher.applies(file)) continue;
    if (isCurrent(existing, enricher)) {
      skipped.push(enricher.name);
      continue;
    }
    // Record a failure reason on the doc and tally it, without aborting the
    // remaining stages. A failed stage is NOT version-stamped, so a later scan
    // retries it (isCurrent treats a present `<name>_error` as stale).
    const recordFailure = (msg) => {
      update[errorField(enricher)] = String(msg);
      failed.push(enricher.name);
      debugErr("enricher %s failed for %s: %s", enricher.name, file.relPath, msg);
    };
    try {
      const t0 = process.hrtime.bigint();
      const fields = (await enricher.enrich({ file, hash, absPath: file.absPath, existing })) || {};
      debugTiming("%s %dms %s", enricher.name, Math.round(Number(process.hrtime.bigint() - t0) / 1e6), file.relPath);
      // An enricher may report a soft failure via an `error` field while still
      // returning (usually empty) output — treat that like a thrown failure, but
      // don't double-log (the enricher already logged on its own `:error`).
      const { error: softError, ...output } = fields;
      Object.assign(update, output);
      if (softError) {
        update[errorField(enricher)] = String(softError);
        failed.push(enricher.name);
      } else {
        // Stamp the producing version alongside the output, so a future logic
        // change (a bumped `version`) is detected and regenerated on a full scan.
        update[versionField(enricher)] = enricher.version || 1;
        // Clear a stale error from a prior failed run now that it succeeded.
        if (existing && existing[errorField(enricher)] != null) update[errorField(enricher)] = null;
        ran.push(enricher.name);
      }
    } catch (err) {
      // Escaped (un-caught) enricher error: record + log here (Level 1 fix).
      recordFailure(err.message);
    }
  }

  // Write only when there's something new (a fresh base doc, or new fields).
  if (!existing || Object.keys(update).length > 1) {
    await meili.updateFields(update);
  }

  return { hash, ran, skipped, failed };
}

module.exports = { runFile, hasAllFields, isCurrent };
