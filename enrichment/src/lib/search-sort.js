// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// Server-side result ordering for /search.
//
// Meili honors a `sort` for a keyword/filter search, but SILENTLY IGNORES it for
// a hybrid/vector search — those hits always come back by descending semantic
// score. So when a date sort is requested on a smart (hybrid) search, the route
// fetches the score-thresholded match set and orders it here instead.
//
// MANUAL_SORT_MAX caps that fetch. It's Meili's default `maxTotalHits` (1000);
// the smart score threshold keeps real match sets well under it, so a page beyond
// the cap isn't reachable — an accepted limit, as with any large result window.
const MANUAL_SORT_MAX = 1000;

/**
 * Order hits by a list of "field:dir" keys (e.g. ["taken_at:desc",
 * "last_modified:desc"]), replicating Meili's OWN sort semantics so the smart
 * path matches the keyword path: a doc MISSING the current key always sorts last
 * (regardless of asc/desc), and later keys break ties — including among the docs
 * that are missing an earlier key (e.g. no EXIF `taken_at` → ordered by
 * `last_modified`). Returns a new array; does not mutate the input.
 */
function sortHitsByKeys(hits, sortKeys) {
  const keys = sortKeys.map((s) => {
    const [field, dir] = s.split(":");
    return { field, dir: dir === "asc" ? 1 : -1 };
  });
  return [...hits].sort((a, b) => {
    for (const { field, dir } of keys) {
      const av = a[field];
      const bv = b[field];
      const aMissing = av === undefined || av === null;
      const bMissing = bv === undefined || bv === null;
      if (aMissing && bMissing) continue; // tie on this key → fall through to the next
      if (aMissing) return 1; // a missing value always sorts last...
      if (bMissing) return -1; // ...regardless of asc/desc
      if (av < bv) return -dir;
      if (av > bv) return dir;
    }
    return 0;
  });
}

module.exports = { MANUAL_SORT_MAX, sortHitsByKeys };
