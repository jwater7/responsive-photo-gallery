// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * OCR quality aggregation for the admin "OCR detail" panel. Unlike the O(1)
 * coverage snapshot (meili.indexStats / fieldDistribution), this needs the
 * actual per-doc OCR values, so `compute()` paginates every doc's OCR fields —
 * heavier, hence fetched on demand rather than polled. `summarize()` is pure
 * (no I/O) so it can be unit-tested.
 */

const meili = require("./meili");

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pctl = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;

/**
 * Aggregate OCR quality from docs carrying {path, content, confidence,
 * ocr_version, ocr_error}. Confidence is the stored 0-1 mean kept-word value.
 * @param {Array<object>} docs
 */
function summarize(docs) {
  let withText = 0;
  let empty = 0;
  let withError = 0;
  const confs = [];
  const lens = [];
  const versions = {};
  const errors = [];
  for (const d of docs) {
    const content = (d.content || "").trim();
    if (content) {
      withText++;
      confs.push(d.confidence || 0);
      lens.push(content.length);
    } else {
      empty++;
    }
    const v = d.ocr_version == null ? "unstamped" : String(d.ocr_version);
    versions[v] = (versions[v] || 0) + 1;
    if (d.ocr_error) {
      withError++;
      if (errors.length < 5) errors.push({ path: d.path, error: String(d.ocr_error) });
    }
  }
  confs.sort((a, b) => a - b);
  lens.sort((a, b) => a - b);

  // Confidence buckets on the stored 0-1 scale (raw Tesseract conf / 100).
  const buckets = { lt50: 0, c50_69: 0, c70_84: 0, c85_100: 0 };
  for (const c of confs) {
    if (c < 0.5) buckets.lt50++;
    else if (c < 0.7) buckets.c50_69++;
    else if (c < 0.85) buckets.c70_84++;
    else buckets.c85_100++;
  }

  return {
    totalDocs: docs.length,
    withText,
    empty,
    withError,
    versions,
    confidence: withText
      ? { mean: mean(confs), median: pctl(confs, 0.5), p10: pctl(confs, 0.1), buckets }
      : null,
    contentLength: withText
      ? { mean: Math.round(mean(lens)), median: pctl(lens, 0.5), max: lens[lens.length - 1] }
      : null,
    errors,
  };
}

/** Fetch the OCR fields of every doc and summarize. */
async function compute() {
  const docs = await meili.allDocs(["path", "content", "confidence", "ocr_version", "ocr_error"]);
  return summarize(docs);
}

module.exports = { summarize, compute };
