// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

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
  walkMedia,
} = require("rpg-media-types");

/**
 * Recursively walk an image directory and return the supported media files
 * found beneath it. Traversal is the shared rpg-media-types walker; this
 * module contributes enrichment's exclude POLICY (the fail-open loadExcludes
 * read) and the enrichment entry shape.
 *
 * Each entry is relative to `baseDir` using POSIX separators so the first path
 * segment is the album name (e.g. "holidays" in "holidays/beach.jpg"). Files in
 * `baseDir` itself are reported with the album "root".
 *
 * Excluded directories (the gallery's shared excludes.json, relative to
 * IMAGE_PATH) are not descended. The list is loaded FRESH per walk (so each
 * reconcile/reap picks up the current file — the file is the single source of
 * truth). Tests may pass `excludes` explicitly to bypass the file read.
 *
 * @param {string} baseDir
 * @param {object} [opts]
 * @param {string[]|null} [opts.excludes=null] normalized excludes (null = load fresh)
 * @returns {Promise<Array<{album: string, relPath: string, absPath: string}>>}
 */
async function walkDir(baseDir, { excludes = null } = {}) {
  const resolved = excludes === null ? loadExcludes() : excludes;
  const files = await walkMedia(baseDir, {
    shouldSkipDir: (rel) => isExcluded(rel, resolved),
  });
  return files.map(({ rel, abs }) => ({
    album: rel.includes("/") ? rel.split("/")[0] : "root",
    relPath: rel,
    absPath: abs,
  }));
}

module.exports = walkDir;
module.exports.SUPPORTED_FORMAT_REGEXP = SUPPORTED_FORMAT_REGEXP;
module.exports.VIDEO_FORMAT_REGEXP = VIDEO_FORMAT_REGEXP;
module.exports.MEDIA_FORMAT_REGEXP = MEDIA_FORMAT_REGEXP;
module.exports.isExcluded = isExcluded;
