// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * OCR enricher — extracts visible text into `content`/`confidence` via the
 * configured OCR engine (native tesseract by default). The pipeline depends
 * only on this enricher interface, so the engine can change without touching
 * anything else.
 */

const { SUPPORTED_FORMAT_REGEXP } = require("../lib/walk-dir");
const engine = require("./ocr-engines");

const debugErr = require("debug")("responsive-photo-gallery:ocr:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

module.exports = {
  name: "ocr",
  // v2: Tier-1 quality tuning (confidence filtering on by default, improved
  // preprocessing, PSM/tessdata knobs). Bumped past 1 so a full scan regenerates
  // docs OCR'd by the pre-Tier-1 engine. See TODO Enrichment #7/#9.
  version: 2,
  outputFields: ["content", "confidence"],
  applies: (file) => SUPPORTED_FORMAT_REGEXP.test(file.relPath),
  async enrich({ absPath }) {
    try {
      return await engine.recognize(absPath);
    } catch (err) {
      debugErr("extraction failed for %s: %s", absPath, err.message);
      // `error` is consumed by the pipeline (→ `ocr_error`) to distinguish a
      // failed run from a legitimately text-free image, and to force a retry.
      return { content: "", confidence: 0, error: err.message };
    }
  },
};
