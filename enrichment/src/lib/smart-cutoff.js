// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Relative-relevance trim for smart (hybrid/semantic) search results — the
 * replacement for the absolute `rankingScoreThreshold`, which cannot work on
 * CLIP-style scores (see config.js `smartCutoffWindow` for the measurements
 * and the derivation of the defaults).
 *
 * Applied server-side to the full ranked working set (the same
 * MANUAL_SORT_MAX fetch the hybrid date-sort already uses), BEFORE any date
 * sort, so "Smart + Newest" means "the relevant matches, newest first".
 */

/**
 * Trim `hits` (Meili order: `_rankingScore` descending) to the relevant head:
 * keep hits scoring within `window` of the best hit, but never fewer than
 * `min` (by rank) and never more than `max`.
 *
 * @param {Array<{_rankingScore?: number}>} hits ranked descending
 * @param {{smartCutoffWindow: number, smartMinResults: number, smartMaxResults: number}} cfg
 * @returns {Array} a new, possibly shorter array (input not mutated)
 */
function applySmartCutoff(hits, cfg) {
  if (!hits.length) return [];
  const top = hits[0]._rankingScore ?? 0;
  const floor = top - cfg.smartCutoffWindow;
  let end = hits.length;
  for (let i = 0; i < hits.length; i++) {
    if ((hits[i]._rankingScore ?? 0) < floor) {
      end = i;
      break;
    }
  }
  end = Math.min(Math.max(end, cfg.smartMinResults), cfg.smartMaxResults, hits.length);
  return hits.slice(0, end);
}

module.exports = { applySmartCutoff };
