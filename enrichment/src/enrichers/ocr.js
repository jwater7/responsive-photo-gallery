// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * OCR enricher — extracts visible text into `content`/`confidence` via the
 * configured OCR engine (native tesseract by default). The pipeline depends
 * only on this enricher interface, so the engine can change without touching
 * anything else.
 *
 * Handles both images and videos (like geo.js/visual.js, the branch IS the
 * dispatcher — see walk-dir.js):
 *   - image → engine.recognize(file)
 *   - video → engine.recognize() over each keyframe (the same frames the
 *             visual stage embeds, shared via video-frames.js), recognized
 *             lines deduplicated across frames so text that persists on
 *             screen (a sign, a title card) lands once. The engine interface
 *             is path-based, so each frame buffer round-trips a temp file —
 *             consistent with the engine's own internal temp handling.
 */

const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { SUPPORTED_FORMAT_REGEXP, VIDEO_FORMAT_REGEXP, MEDIA_FORMAT_REGEXP } = require("../lib/walk-dir");
const { isDecodableImage, undecodableError } = require("../lib/decodable");
const { keyframes } = require("../lib/video-frames");
const engine = require("./ocr-engines");

const debugErr = require("debug")("responsive-photo-gallery:ocr:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

/**
 * Merge per-frame OCR results: lines deduplicated across frames by normalized
 * comparison (trimmed, whitespace-collapsed, case-folded), keeping each line's
 * first-seen original form. Confidence is the mean over frames that yielded
 * text (a text-free frame says nothing about recognition quality).
 */
function mergeFrameResults(results) {
  const seen = new Set();
  const lines = [];
  const confs = [];
  for (const r of results) {
    for (const raw of (r.content || "").split("\n")) {
      const line = raw.trim().replace(/\s+/g, " ");
      const norm = line.toLowerCase();
      if (!line || seen.has(norm)) continue;
      seen.add(norm);
      lines.push(line);
    }
    if ((r.content || "").trim()) confs.push(r.confidence || 0);
  }
  return {
    content: lines.join("\n"),
    confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0,
  };
}

/** Video branch: OCR each keyframe (via temp files) and merge. Throws on
 *  extraction/engine failure — the caller records the soft-fail. */
async function recognizeVideo(absPath) {
  const frames = await keyframes(absPath);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rpg-ocr-frames-"));
  try {
    const results = [];
    for (let i = 0; i < frames.length; i++) {
      const framePath = path.join(dir, `frame-${i}.png`);
      await fs.writeFile(framePath, frames[i]);
      results.push(await engine.recognize(framePath));
    }
    return mergeFrameResults(results);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

module.exports = {
  name: "ocr",
  // v2: Tier-1 quality tuning (confidence filtering on by default, improved
  // preprocessing, PSM/tessdata knobs). Bumped past 1 so a full scan regenerates
  // docs OCR'd by the pre-Tier-1 engine. See TODO Enrichment #7/#9.
  // Adding the video branch deliberately did NOT bump it: videos had never been
  // stamped (applies() excluded them), so widening the gate enqueues them by
  // construction while already-OCR'd images stay current.
  version: 2,
  outputFields: ["content", "confidence"],
  applies: (file) => MEDIA_FORMAT_REGEXP.test(file.relPath),
  async enrich({ file, absPath }) {
    try {
      if (VIDEO_FORMAT_REGEXP.test(file.relPath)) {
        return await recognizeVideo(absPath);
      }
      // Capability gate (probed once, no decode attempt): the OCR preprocess
      // rides on sharp, so a format this build can't decode soft-fails with a
      // stable reason and self-heals on a capable build (see lib/decodable.js).
      // Video keyframes bypass it — they are ffmpeg-decoded PNGs.
      if (!isDecodableImage(absPath)) {
        return { content: "", confidence: 0, error: undecodableError(absPath) };
      }
      return await engine.recognize(absPath);
    } catch (err) {
      debugErr("extraction failed for %s: %s", absPath, err.message);
      // `error` is consumed by the pipeline (→ `ocr_error`) to distinguish a
      // failed run from a legitimately text-free image, and to force a retry.
      return { content: "", confidence: 0, error: err.message };
    }
  },
};
