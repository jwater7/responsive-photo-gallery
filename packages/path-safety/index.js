// vim: tabstop=2 shiftwidth=2 expandtab
'use strict'

/**
 * The path-containment primitive both services gate caller-supplied paths
 * with. One implementation, one contract: this logic is security-critical and
 * previously existed as five near-copies (gallery image-handler, album-build,
 * two inline route checks, and a weaker '..'-substring variant in the
 * enrichment API) — a hardening fix had to be found and applied five times.
 * gallery/test/path-traversal.test.js exercises the same behavior end-to-end
 * over HTTP.
 */

const path = require('path')

/**
 * Resolve a caller-supplied `sub` path confined to `root`.
 *
 * Returns the absolute resolved path, or '' when `sub` is missing/non-string
 * or escapes the root. Notes on the contract (kept bit-for-bit from the
 * gallery's originals):
 *  - Boundary test, not a string prefix: a bare startsWith(root) would also
 *    accept a sibling like "<root>-evil"; the path separator (or an exact
 *    match on the root itself) is required.
 *  - `sub` is JOINED under root (an absolute `sub` is appended, not obeyed),
 *    so an absolute input lands inside the root rather than escaping it.
 *  - '' (not a throw) for a non-string `sub`, so an omitted query param is a
 *    caller error the routes turn into a 400, never a TypeError 500.
 *
 * @param {string} root the containment root directory
 * @param {string} sub  caller-supplied path relative to root
 * @returns {string} absolute path inside root, or '' when rejected
 */
function resolveWithin(root, sub) {
  if (typeof sub !== 'string' || !sub) return ''
  const base = path.resolve(root)
  const resolved = path.resolve(path.join(base, path.normalize(sub)))
  return resolved === base || resolved.startsWith(base + path.sep)
    ? resolved
    : ''
}

module.exports = { resolveWithin }
