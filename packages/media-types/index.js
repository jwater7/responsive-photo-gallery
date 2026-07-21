// vim: tabstop=2 shiftwidth=2 expandtab
'use strict'

/**
 * The media-type registry: what counts as a photo or a video, defined ONCE.
 *
 * Before this package, four independent format lists (gallery album-build,
 * enrichment walk-dir, fast-image-processing isVideo, enrichment hash MIME map)
 * and three directory walkers had drifted into live bugs (.m4v/.webm silently
 * missing from sprites, .gif/.heic/.avif never enriched, excludes ignored by
 * /list). Every consumer now derives its sets, predicates, regexps, and MIME
 * types from here, so a format added once is added everywhere.
 *
 * The walker lives here too (media enumeration is inseparable from "what is
 * media"), but exclude POLICY does not: consumers inject a shouldSkipDir
 * predicate, keeping this package free of rpg-config and preserving the
 * intentional difference between the gallery's and enrichment's exclude reads.
 */

const fs = require('fs')
const path = require('path')

// Canonical extension sets (lowercase, with the leading dot — the shape
// path.extname() returns). These are album-build's original lists, which were
// the broadest of the four copies; the narrower lists were drift, not policy.
const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.avif',
  '.bmp',
])
const VIDEO_EXTS = new Set(['.mov', '.mp4', '.m4v', '.webm'])

const extOf = (p) => path.extname(p).toLowerCase()

const isImage = (p) => IMAGE_EXTS.has(extOf(p))
const isVideo = (p) => VIDEO_EXTS.has(extOf(p))
const isMedia = (p) => isImage(p) || isVideo(p)

// Extension -> MIME. The base doc's mime_type drives video-vs-image rendering
// on the enrichment frontend (map slide, lightbox), so every registry
// extension must map.
const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
}

const mimeFor = (p) => MIME_BY_EXT[extOf(p)] || 'application/octet-stream'

// Every MIME type a registry video can carry (deduped — .mov and .mp4 map to
// distinct types but a future extension may alias an existing one). Consumers
// filtering docs by kind (e.g. the search API's excludeVideos) derive from
// this, so a new registry format is covered with no filter-code change.
const VIDEO_MIME_TYPES = [...new Set([...VIDEO_EXTS].map((e) => MIME_BY_EXT[e]))]

/**
 * Derive a case-insensitive filename filter regexp from an extension set, so
 * regexp consumers (enrichment applies() gates, the watcher, /enqueue) stay in
 * lockstep with the sets instead of hand-maintaining alternations.
 */
function extsToRegexp(exts) {
  const alts = [...exts].map((e) => e.replace(/^\./, ''))
  return new RegExp(`\\.(${alts.join('|')})$`, 'i')
}

const IMAGE_FORMAT_REGEXP = extsToRegexp(IMAGE_EXTS)
const VIDEO_FORMAT_REGEXP = extsToRegexp(VIDEO_EXTS)
const MEDIA_FORMAT_REGEXP = extsToRegexp(
  new Set([...IMAGE_EXTS, ...VIDEO_EXTS])
)

/**
 * "Supported extension" and "decodable by THIS build" are distinct concepts:
 * ffmpeg decodes every registry video, but sharp's image coverage depends on
 * how its bundled libvips was built (HEIF/AVIF only when compiled in; BMP
 * never). Pixel-decoding consumers (sprite build, visual/OCR enrichment) gate
 * on this; metadata-only consumers (geo, caption via exifr) do not.
 *
 * Pure function over sharp's `format` map (pass `require('sharp').format`) so
 * this package needs no sharp dependency and the mapping is unit-testable.
 */
const SHARP_INPUT_FORMAT_BY_EXT = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.gif': 'gif',
  '.tif': 'tiff',
  '.tiff': 'tiff',
  '.heic': 'heif',
  '.heif': 'heif',
  '.avif': 'heif',
  '.bmp': null, // no libvips loader in any sharp build
}

function decodableImageExts(sharpFormat) {
  const out = new Set()
  for (const [ext, key] of Object.entries(SHARP_INPUT_FORMAT_BY_EXT)) {
    const fmt = key && sharpFormat && sharpFormat[key]
    if (fmt && fmt.input && fmt.input.file) out.add(ext)
  }
  return out
}

/**
 * The one excludes-aware media walker. Enumerates every registry media file
 * under `baseDir` and returns [{ rel, abs, size?, mtimeMs? }] with `rel`
 * POSIX-separated relative to baseDir.
 *
 * Traversal semantics (the strictest of the three walkers it replaced, so
 * every plane now agrees):
 *  - dot-entries (files and directories) are skipped
 *  - a directory is not descended when `shouldSkipDir(relPosix)` returns true
 *  - unreadable directories contribute nothing (no throw)
 *  - symlinks are followed via stat; entries whose stat fails (e.g. broken
 *    symlinks) are skipped
 *  - only registry media files are returned
 *
 * @param {string} baseDir
 * @param {object} [opts]
 * @param {(relPosix: string) => boolean} [opts.shouldSkipDir] exclude policy,
 *        injected by the consumer (gallery vs enrichment read excludes
 *        differently on purpose)
 * @param {boolean} [opts.withStats] also stat each file and include
 *        `size`/`mtimeMs` (skipping files whose stat fails)
 * @returns {Promise<Array<{rel: string, abs: string, size?: number, mtimeMs?: number}>>}
 */
async function walkMedia(baseDir, { shouldSkipDir, withStats } = {}) {
  const out = []
  const walk = async (rel) => {
    const dirAbs = rel ? path.join(baseDir, rel) : baseDir
    let entries
    try {
      entries = await fs.promises.readdir(dirAbs, { withFileTypes: true })
    } catch (_) {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name
      const abs = path.join(baseDir, entryRel)

      let isDir = entry.isDirectory()
      let isFile = entry.isFile()
      let stat = null
      if (entry.isSymbolicLink() || (withStats && isFile)) {
        try {
          stat = await fs.promises.stat(abs)
        } catch (_) {
          continue // broken symlink or vanished entry
        }
        isDir = stat.isDirectory()
        isFile = stat.isFile()
      }

      if (isDir) {
        if (shouldSkipDir && shouldSkipDir(entryRel)) continue
        await walk(entryRel)
      } else if (isFile && isMedia(entry.name)) {
        const item = { rel: entryRel, abs }
        if (withStats) {
          item.size = stat.size
          item.mtimeMs = Math.round(stat.mtimeMs)
        }
        out.push(item)
      }
    }
  }
  await walk('')
  return out
}

module.exports = {
  IMAGE_EXTS,
  VIDEO_EXTS,
  isImage,
  isVideo,
  isMedia,
  MIME_BY_EXT,
  mimeFor,
  VIDEO_MIME_TYPES,
  extsToRegexp,
  IMAGE_FORMAT_REGEXP,
  VIDEO_FORMAT_REGEXP,
  MEDIA_FORMAT_REGEXP,
  decodableImageExts,
  walkMedia,
}
