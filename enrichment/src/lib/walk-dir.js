// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

const fs = require("fs");
const path = require("path");

const { loadExcludes, isExcluded } = require("rpg-config");

// All three regexps are DERIVED from the shared registry's extension sets, so
// enrichment can never drift from the gallery again (the old hand-written
// image regexp had drifted: gif/heic/heif/avif appeared in albums but were
// never enriched). The exported names are kept — geo.js, visual.js, ocr.js,
// caption.js, and enrichment-api.js import them. VIDEO stays separate from the
// image regexp so the image-only enrichers, which gate their applies() on
// SUPPORTED_FORMAT_REGEXP, keep skipping video by construction — there is no
// job `type` field; per-enricher applies() IS the dispatcher.
const {
  IMAGE_FORMAT_REGEXP: SUPPORTED_FORMAT_REGEXP,
  VIDEO_FORMAT_REGEXP,
  MEDIA_FORMAT_REGEXP,
} = require("rpg-media-types");

/**
 * Recursively walk an image directory and return the supported image files
 * found beneath it.
 *
 * Each entry is relative to `baseDir` using POSIX separators so the first path
 * segment is the album name (e.g. "holidays" in "holidays/beach.jpg"). Files in
 * `baseDir` itself are reported with the album "root".
 *
 * Excluded directories (the gallery's shared excludes.json, relative to
 * IMAGE_PATH) are not descended. The list is loaded FRESH at the top-level call
 * (so each reconcile/reap picks up the current file — the file is the single
 * source of truth) and threaded through recursion. Tests may pass `excludes`
 * explicitly to bypass the file read.
 *
 * @param {string} baseDir
 * @param {string} [dir=""]
 * @param {Array<{album: string, relPath: string, absPath: string}>} [acc=[]]
 * @param {string[]|null} [excludes=null] normalized excludes (null = load fresh)
 * @returns {Array<{album: string, relPath: string, absPath: string}>}
 */
function walkDir(baseDir, dir = "", acc = [], excludes = null) {
  // Top-level entry: load the exclude list once, then thread it down.
  if (excludes === null) excludes = loadExcludes();

  const currentAbs = path.join(baseDir, dir);

  let entries;
  try {
    entries = fs.readdirSync(currentAbs, { withFileTypes: true });
  } catch (_) {
    return acc;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const relPath = dir ? `${dir}/${entry.name}` : entry.name;
    const absPath = path.join(baseDir, relPath);

    if (entry.isDirectory()) {
      if (isExcluded(relPath, excludes)) continue;
      walkDir(baseDir, relPath, acc, excludes);
    } else if (entry.isFile() && MEDIA_FORMAT_REGEXP.test(entry.name)) {
      const album = relPath.includes("/") ? relPath.split("/")[0] : "root";
      acc.push({ album, relPath, absPath });
    }
  }

  return acc;
}

module.exports = walkDir;
module.exports.SUPPORTED_FORMAT_REGEXP = SUPPORTED_FORMAT_REGEXP;
module.exports.VIDEO_FORMAT_REGEXP = VIDEO_FORMAT_REGEXP;
module.exports.MEDIA_FORMAT_REGEXP = MEDIA_FORMAT_REGEXP;
module.exports.isExcluded = isExcluded;
