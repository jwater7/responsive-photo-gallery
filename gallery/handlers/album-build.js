// vim: tabstop=2 shiftwidth=2 expandtab
//
// Album build engine: turns an album directory on the image filesystem into a
// cached, browsable set of artifacts — a collage cover, date-grouped sprite
// sheets, and a manifest mapping each grid cell back to its source image.
//
// This is NEW code and uses async/await throughout (not the callback style of
// image-handler.js). It depends only on the filesystem + the vendored
// fast-image-processing engine; it never touches the enrichment store, so album
// browsing keeps working when the enrichment plane is down.
//
// Layout (per album), under CACHE_PATH:
//   <album>/manifest.json            groups, sheets, cover, cell->image map
//   <album>/cover.jpg                collage cover (home preview)
//   <album>/sprites/<group>-<n>.jpg  date-grouped sprite sheets
//
// The build is request-triggered and single-flight: concurrent requests for a
// cold album attach to one in-progress build. A whole-album content hash gates
// "anything changed?"; an unchanged album is served straight from cache.

'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { mkdirp } = require('mkdirp')

const fip = require('fast-image-processing')

const runtimeConfig = require('rpg-config')

const debug = require('debug')('responsive-photo-gallery:album-build')
const debugErr = require('debug')('responsive-photo-gallery:album-build:error')
debugErr.enabled = true // errors are always-on, not gated by DEBUG

const IMAGE_PATH = process.env.IMAGE_PATH || '/images'
const CACHE_PATH = process.env.CACHE_PATH || '/data/cache'

// Sprite cells are baked at the largest intended display size and CSS-scaled down
// in the browser (scaling down stays crisp). One sheet resolution serves all zoom
// levels; only the column count + CSS scale change.
const CELL_SIZE = parseInt(process.env.SPRITE_CELL_SIZE, 10) || 256
const SHEET_COLUMNS = parseInt(process.env.SPRITE_SHEET_COLUMNS, 10) || 5
const SHEET_ROWS = parseInt(process.env.SPRITE_SHEET_ROWS, 10) || 8
const CELLS_PER_SHEET = SHEET_COLUMNS * SHEET_ROWS
const RENDER_CONCURRENCY =
  parseInt(process.env.SPRITE_RENDER_CONCURRENCY, 10) || 8

// Cover is an evenly-sampled set of thumbnails packed into ONE sprite sheet; the
// home preview lays its cells out as a responsive grid (so the layout adapts to
// the viewport on the client, not baked in). The cell cap bounds the sample /
// bytes for huge albums; the sheet column count only affects the baked packing.
const COVER_CELL_SIZE = parseInt(process.env.COVER_CELL_SIZE, 10) || 128
const COVER_MAX_CELLS = parseInt(process.env.COVER_MAX_CELLS, 10) || 48
const COVER_SHEET_COLUMNS = parseInt(process.env.COVER_SHEET_COLUMNS, 10) || 8

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

const isMedia = (rel) => {
  const ext = path.extname(rel).toLowerCase()
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)
}

// Resolve a caller-supplied album name to an absolute path confined to `root`.
// Returns '' on traversal attempts.
const safeJoin = (root, sub) => {
  const base = path.resolve(root)
  const resolved = path.resolve(path.join(base, path.normalize(sub)))
  // Boundary test, not a string prefix: `startsWith(base)` alone would also
  // accept a sibling like "<base>-evil". Require the path separator (or an
  // exact match on the root itself).
  return resolved === base || resolved.startsWith(base + path.sep)
    ? resolved
    : ''
}

const md5 = (str) => crypto.createHash('md5').update(str).digest('hex')

// ---- single-flight + status bookkeeping -----------------------------------

const inFlight = new Map() // album -> Promise<manifest>  (the build pass)
const ensuring = new Map() // album -> Promise            (scan + decide + build)
const statusMap = new Map() // album -> { state, done, total, sheetsReady, error }

const getStatus = (album) =>
  statusMap.get(album) || {
    state: 'unknown',
    done: 0,
    total: 0,
    sheetsReady: 0,
  }

// Global cap on concurrent background "ensure" passes (each does the slow
// per-file scan + a sprite build). Requests return 202 immediately, so the
// frontend's request cap can't throttle this work — bound it here so a
// cold-library first load can't re-saturate the event loop / sharp threadpool.
const ENSURE_CONCURRENCY =
  parseInt(process.env.ALBUM_ENSURE_CONCURRENCY, 10) || 2
let ensureActive = 0
const ensureWaiters = []
function acquireEnsureSlot() {
  if (ensureActive < ENSURE_CONCURRENCY) {
    ensureActive++
    return Promise.resolve()
  }
  return new Promise((resolve) => ensureWaiters.push(resolve))
}
function releaseEnsureSlot() {
  const next = ensureWaiters.shift()
  if (next) next()
  else ensureActive--
}

// ---- helpers ---------------------------------------------------------------

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i], i)
      }
    })
  await Promise.all(workers)
  return results
}

// `excludes` is the normalized exclude list (relative to IMAGE_PATH); a subdir
// whose IMAGE_PATH-relative path matches an excluded prefix is not descended.
// This is how a *nested* exclude (e.g. "work/scans") drops files from an album
// that is otherwise still listed/built.
async function walkMedia(baseDir, dir = baseDir, out = [], excludes = []) {
  let entries
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch (err) {
    return out
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const relToImage = path
        .relative(IMAGE_PATH, abs)
        .split(path.sep)
        .join('/')
      if (runtimeConfig.isExcluded(relToImage, excludes)) continue
      await walkMedia(baseDir, abs, out, excludes)
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, abs)
      if (!isMedia(rel)) continue
      try {
        const stat = await fs.promises.stat(abs)
        out.push({
          rel,
          abs,
          size: stat.size,
          mtimeMs: Math.round(stat.mtimeMs),
        })
      } catch (err) {
        // unreadable entry; skip
      }
    }
  }
  return out
}

// List an album's media files (sorted) plus a whole-album content hash.
async function scanAlbum(album) {
  const albumDir = safeJoin(IMAGE_PATH, album)
  if (!albumDir) {
    const err = new Error('Invalid album')
    err.code = 400
    throw err
  }
  const excludes = await runtimeConfig.getExcludes()
  const files = await walkMedia(albumDir, albumDir, [], excludes)
  files.sort((a, b) => a.rel.localeCompare(b.rel))
  for (const f of files) f.srcHash = md5(`${f.rel}:${f.size}:${f.mtimeMs}`)
  const albumHash = md5(files.map((f) => f.srcHash).join('|'))
  return { files, albumHash }
}

const albumCacheDir = (album) => safeJoin(CACHE_PATH, album)

async function readManifest(album) {
  const dir = albumCacheDir(album)
  if (!dir) return null
  try {
    const raw = await fs.promises.readFile(
      path.join(dir, 'manifest.json'),
      'utf8'
    )
    return JSON.parse(raw)
  } catch (err) {
    return null
  }
}

// Atomically (temp + rename) persist a manifest object back to disk. Used to
// backfill the cheap fingerprint onto a manifest built before fingerprinting.
async function writeManifest(album, manifest) {
  const dir = albumCacheDir(album)
  if (!dir) return
  await mkdirp(dir)
  const tmp = path.join(
    dir,
    `.manifest-${crypto.randomBytes(4).toString('hex')}.json`
  )
  await fs.promises.writeFile(tmp, JSON.stringify(manifest))
  await fs.promises.rename(tmp, path.join(dir, 'manifest.json'))
}

// Cheap album freshness fingerprint. Recurses with readdir only (NO per-file
// stat — that per-file stat over the image mount is what makes scanAlbum slow)
// and combines each directory's mtime with the media-file count. Adding,
// removing, or renaming a file bumps the containing directory's mtime, so this
// catches the changes a photo album actually undergoes. In-place content edits
// (same name, same dir) are out of scope here — the authoritative content hash
// on a full build still covers those, as does the periodic reconcile. Persisted
// in the manifest so warm loads skip the expensive walk entirely. Returns
// { key, count } — count lets callers detect an empty album cheaply (no walk).
async function quickFingerprint(albumDir) {
  const dirSigs = []
  let count = 0
  const walk = async (dir) => {
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch (err) {
      return
    }
    let mtimeMs = 0
    try {
      mtimeMs = Math.round((await fs.promises.stat(dir)).mtimeMs)
    } catch (err) {
      // unreadable dir; still record its presence by name
    }
    dirSigs.push(`${path.relative(albumDir, dir) || '.'}:${mtimeMs}`)
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile() && isMedia(path.relative(albumDir, abs))) {
        count++
      }
    }
  }
  await walk(albumDir)
  dirSigs.sort()
  return { key: md5(`${count}|${dirSigs.join('|')}`), count }
}

const monthLabel = (key) => {
  if (key === 'unknown') return 'Undated'
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, (m || 1) - 1, 1)
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

// Evenly sample up to `max` items across the list (keeps the cover representative).
const sampleEven = (arr, max) => {
  if (arr.length <= max) return arr
  const step = arr.length / max
  const out = []
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)])
  return out
}

async function pruneSprites(spritesDir, keep) {
  let existing
  try {
    existing = await fs.promises.readdir(spritesDir)
  } catch (err) {
    return
  }
  for (const file of existing) {
    if (!keep.has(file)) {
      await fs.promises.unlink(path.join(spritesDir, file)).catch(() => {})
    }
  }
}

// ---- the build pass --------------------------------------------------------

async function buildAlbum(album, files, albumHash, quickKey) {
  const status = {
    state: 'building',
    done: 0,
    total: files.length,
    sheetsReady: 0,
    startedAt: Date.now(),
    error: null,
  }
  statusMap.set(album, status)

  const cacheDir = albumCacheDir(album)
  const spritesDir = path.join(cacheDir, 'sprites')
  const tmpDir = path.join(
    cacheDir,
    '.tmp-' + crypto.randomBytes(4).toString('hex')
  )

  try {
    await mkdirp(tmpDir)

    // 1. Decode each source ONCE -> cell buffer + oriented dims + capture date.
    const rendered = []
    const skipped = []
    await mapLimit(files, RENDER_CONCURRENCY, async (file) => {
      try {
        const cell = await fip.renderCell(file.abs, CELL_SIZE)
        rendered.push({ ...file, cell })
      } catch (err) {
        debugErr('skip', file.rel, err.message)
        skipped.push(file.rel)
      } finally {
        status.done++
      }
    })

    // 2. Bucket into month groups by EXIF capture date.
    const groupsMap = new Map()
    for (const r of rendered) {
      const d = new Date(r.cell.captureDate)
      const key = isNaN(d.getTime())
        ? 'unknown'
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!groupsMap.has(key)) groupsMap.set(key, [])
      groupsMap.get(key).push(r)
    }
    const groupKeys = [...groupsMap.keys()].sort()

    // 3. Pack each group into sprite sheets; write each to the temp dir.
    const sheets = []
    const groups = []
    let sheetN = 0
    for (const key of groupKeys) {
      const items = groupsMap
        .get(key)
        .sort(
          (a, b) =>
            new Date(a.cell.captureDate) - new Date(b.cell.captureDate) ||
            a.rel.localeCompare(b.rel)
        )
      const sheetIndexes = []
      for (let i = 0; i < items.length; i += CELLS_PER_SHEET) {
        const chunk = items.slice(i, i + CELLS_PER_SHEET)
        // Content-addressed sheet name: identical content keeps the same filename
        // across rebuilds, so the browser cache stays valid and only changed sheets
        // are rewritten. No date/grouping coupling in the filename.
        const srcHash = md5(chunk.map((c) => c.srcHash).join('|'))
        const file = `${srcHash}.jpg`
        const geo = await fip.buildSpriteSheet(
          chunk.map((c) => c.cell),
          { cellSize: CELL_SIZE, columns: SHEET_COLUMNS },
          path.join(tmpDir, file)
        )
        const cells = geo.cells.map((g, idx) => ({
          image: chunk[idx].rel,
          x: g.x,
          y: g.y,
          w: g.w,
          h: g.h,
          orientedWidth: chunk[idx].cell.orientedWidth,
          orientedHeight: chunk[idx].cell.orientedHeight,
          format: chunk[idx].cell.format,
        }))
        sheets.push({
          n: sheetN,
          group: key,
          file,
          srcHash,
          columns: geo.columns,
          rows: geo.rows,
          width: geo.width,
          height: geo.height,
          cells,
        })
        sheetIndexes.push(sheetN)
        sheetN++
        status.sheetsReady++
      }
      groups.push({
        key,
        label: monthLabel(key),
        sheets: sheetIndexes,
        count: items.length,
      })
    }

    // 4. Cover sprite sheet: an even sample of thumbnails packed into one sheet.
    //    The manifest carries the cells so the home preview can render them as a
    //    responsive grid (the layout adapts on the client, not baked here).
    //    `rendered` is in decode-completion order (parallel renders finish out of
    //    order), so sort it by capture date before sampling — otherwise the cover
    //    cells come out scrambled and non-deterministic across rebuilds.
    let cover = null
    const coverSorted = [...rendered].sort(
      (a, b) =>
        new Date(a.cell.captureDate) - new Date(b.cell.captureDate) ||
        a.rel.localeCompare(b.rel)
    )
    const coverItems = sampleEven(coverSorted, COVER_MAX_CELLS)
    if (coverItems.length) {
      const geo = await fip.buildSpriteSheet(
        coverItems.map((it) => it.cell),
        {
          cellSize: COVER_CELL_SIZE,
          columns: COVER_SHEET_COLUMNS,
          resize: true,
        },
        path.join(tmpDir, 'cover.jpg')
      )
      cover = {
        file: 'cover.jpg',
        columns: geo.columns,
        rows: geo.rows,
        width: geo.width,
        height: geo.height,
        cells: geo.cells.map((g, i) => ({
          image: coverItems[i].rel,
          x: g.x,
          y: g.y,
          w: g.w,
          h: g.h,
          orientedWidth: coverItems[i].cell.orientedWidth,
          orientedHeight: coverItems[i].cell.orientedHeight,
          format: coverItems[i].cell.format,
        })),
      }
    }

    // 5. Swap temp artifacts into place (atomic per file), prune stale sheets.
    await mkdirp(spritesDir)
    for (const s of sheets) {
      await fs.promises.rename(
        path.join(tmpDir, s.file),
        path.join(spritesDir, s.file)
      )
    }
    if (cover) {
      await fs.promises.rename(
        path.join(tmpDir, 'cover.jpg'),
        path.join(cacheDir, 'cover.jpg')
      )
    }
    await pruneSprites(spritesDir, new Set(sheets.map((s) => s.file)))

    // 6. Write the manifest LAST (temp + rename) — its presence/hash marks the
    //    build complete and current.
    const manifest = {
      album,
      albumHash,
      quickKey,
      builtAt: new Date().toISOString(),
      cellSize: CELL_SIZE,
      columns: SHEET_COLUMNS,
      total: rendered.length,
      skipped,
      groups,
      sheets,
      cover,
    }
    const manifestTmp = path.join(tmpDir, 'manifest.json')
    await fs.promises.writeFile(manifestTmp, JSON.stringify(manifest))
    await fs.promises.rename(manifestTmp, path.join(cacheDir, 'manifest.json'))

    await fs.promises.rm(tmpDir, { recursive: true, force: true })

    status.state = 'ready'
    debug(
      'built',
      album,
      ':',
      sheets.length,
      'sheets,',
      rendered.length,
      'images,',
      skipped.length,
      'skipped'
    )
    return manifest
  } catch (err) {
    status.state = 'error'
    status.error = err.message
    await fs.promises
      .rm(tmpDir, { recursive: true, force: true })
      .catch(() => {})
    debugErr('build failed', album, err)
    throw err
  }
}

// Single-flight wrapper: concurrent triggers for the same album share one build.
function triggerBuild(album, files, albumHash, quickKey) {
  if (inFlight.has(album)) return inFlight.get(album)
  const p = buildAlbum(album, files, albumHash, quickKey).finally(() =>
    inFlight.delete(album)
  )
  inFlight.set(album, p)
  return p
}

// Background worker for a cold / changed / un-fingerprinted album: the slow
// per-file scan, then either a fingerprint backfill (content unchanged) or a
// rebuild. Runs OUTSIDE the request (ensureAlbum returns 202 first) and behind a
// global concurrency slot, so it never blocks a response or saturates the host.
async function runEnsure(album, quickKey, existingManifest) {
  // Mark building up front (before queuing) so the client's status poll shows
  // progress instead of 'unknown' while it waits for a slot.
  statusMap.set(album, {
    state: 'building',
    done: 0,
    total: existingManifest ? existingManifest.total : 0,
    sheetsReady: 0,
  })
  await acquireEnsureSlot()
  try {
    const { files, albumHash } = await scanAlbum(album)
    if (!files.length) {
      statusMap.set(album, {
        state: 'error',
        done: 0,
        total: 0,
        sheetsReady: 0,
        error: 'No media in album',
      })
      return
    }
    // Content actually unchanged — only the fingerprint was stale or missing.
    // Backfill it so the next load takes the cheap path; no rebuild.
    if (existingManifest && existingManifest.albumHash === albumHash) {
      const refreshed = { ...existingManifest, quickKey }
      await writeManifest(album, refreshed).catch(() => {})
      statusMap.set(album, {
        state: 'ready',
        done: refreshed.total,
        total: refreshed.total,
        sheetsReady: refreshed.sheets.length,
      })
      return
    }
    await triggerBuild(album, files, albumHash, quickKey)
  } finally {
    releaseEnsureSlot()
  }
}

// Single-flight wrapper for the whole ensure pass (scan + decide + build), so
// overlapping requests for the same cold album share ONE scan instead of each
// launching a full per-file walk and thrashing the event loop.
function triggerEnsure(album, quickKey, existingManifest) {
  if (ensuring.has(album)) return ensuring.get(album)
  const p = runEnsure(album, quickKey, existingManifest)
    .catch((err) => {
      statusMap.set(album, {
        state: 'error',
        done: 0,
        total: 0,
        sheetsReady: 0,
        error: err.message,
      })
    })
    .finally(() => ensuring.delete(album))
  ensuring.set(album, p)
  return p
}

// Ensure the album's cache is current. Returns:
//   { state: 'ready', manifest }                      cache exists and is current
//   { state: 'building', status }                     a (re)build is in progress
// NEVER blocks on the scan or build — the slow work runs in the background and
// the caller polls album-status and re-requests.
async function ensureAlbum(album) {
  const albumDir = safeJoin(IMAGE_PATH, album)
  if (!albumDir) {
    const err = new Error('Invalid album')
    err.code = 400
    throw err
  }

  // An excluded top-level album never builds — treat it as absent (matches the
  // album list, which also hides it). isExcluded with the bare album name only
  // matches a top-level entry; a nested exclude leaves the album buildable (its
  // subtree is skipped inside walkMedia).
  const excludes = await runtimeConfig.getExcludes()
  if (runtimeConfig.isExcluded(album, excludes)) {
    const err = new Error('No media in album')
    err.code = 404
    throw err
  }

  // Cheap path: if an on-disk manifest's stored fingerprint still matches the
  // album's current cheap fingerprint, serve it without the expensive per-file
  // walk in scanAlbum. This is the hot path for warm albums on the home page.
  const manifest = await readManifest(album)
  const { key: quickKey, count } = await quickFingerprint(albumDir)

  // Empty album (no media) — fail fast and synchronously, the same as before.
  // Cheap to detect here (no per-file walk), and it avoids kicking off a
  // background ensure that would only error and spin the client's status poll.
  if (!count) {
    const err = new Error('No media in album')
    err.code = 404
    throw err
  }

  if (
    manifest &&
    manifest.quickKey === quickKey &&
    !inFlight.has(album) &&
    !ensuring.has(album)
  ) {
    statusMap.set(album, {
      state: 'ready',
      done: manifest.total,
      total: manifest.total,
      sheetsReady: manifest.sheets.length,
    })
    return { state: 'ready', manifest }
  }

  // Cold, changed, or not-yet-fingerprinted: kick off the scan + build in the
  // BACKGROUND (single-flight, concurrency-capped) and return 202 right away so
  // the request never blocks on the per-file walk.
  triggerEnsure(album, quickKey, manifest)
  return { state: 'building', status: getStatus(album) }
}

// Snapshot of in-progress album builds for the admin UI: which albums are
// building (actively scanning/rendering, total > 0) or queued (waiting for a
// build slot, total 0), plus the build-slot usage.
function getActivity() {
  const building = []
  for (const [album, s] of statusMap) {
    if (s.state === 'building') {
      building.push({
        album,
        done: s.done || 0,
        total: s.total || 0,
        sheetsReady: s.sheetsReady || 0,
      })
    }
  }
  // Active (total > 0) first, then queued, then by name.
  building.sort(
    (a, b) => (b.total > 0) - (a.total > 0) || a.album.localeCompare(b.album)
  )
  return {
    building,
    activeBuilds: ensureActive,
    queuedBuilds: ensureWaiters.length,
    concurrency: ENSURE_CONCURRENCY,
  }
}

module.exports = {
  ensureAlbum,
  getStatus,
  getActivity,
  readManifest,
  scanAlbum,
  albumCacheDir,
  // exposed for tests
  buildAlbum,
  _config: { CELL_SIZE, SHEET_COLUMNS, CELLS_PER_SHEET, CACHE_PATH },
}
