#!/usr/bin/env node
// vim: tabstop=2 shiftwidth=2 expandtab
'use strict'

/*
 * gen-test-albums.js — generate synthetic test albums for the gallery.
 *
 * Produces several albums full of numbered, color-coded square images so you
 * can eyeball ordering and month-grouping in the gallery grid:
 *   - a big zero-padded sequence number (#001, #002, …) per image
 *   - a background hue that sweeps with the sequence (a visual gradient: any
 *     out-of-order or missing cell stands out)
 *   - the album name and the image's capture date drawn on the cell
 *
 * Ordering/grouping in the gallery is driven by capture date (the build buckets
 * by month, then sorts by date within a month). Each image therefore gets:
 *   - an embedded EXIF DateTimeOriginal, AND
 *   - a matching file mtime.
 * Both are set because the app's capture-date read currently falls back to
 * mtime (see note at the bottom of this file), so mtime is what actually orders
 * things today; the EXIF is written too so the data is correct regardless.
 *
 * Dates increase monotonically with the sequence number and are spread across
 * `--months` months, so the sequence number == date order and month-group
 * boundaries are visible.
 *
 * Usage:
 *   node scripts/gen-test-albums.js [options]
 *
 * Options:
 *   --out DIR        Output root (one subdir per album). Default: debug-data/pics
 *   --albums N       Number of albums.                    Default: 5
 *   --count N        Images per album (every album).      Default: 400
 *   --counts a,b,c   Per-album counts (overrides --count). e.g. 300,450,600
 *   --prefix NAME    Album dir name prefix.               Default: test-album
 *   --size PX        Square image edge in px.             Default: 512
 *   --months N       Spread dates across this many months. Default: 6
 *   --start DATE     First capture date (YYYY-MM-DD).     Default: 2026-01-01
 *   --concurrency N  Parallel encodes.                    Default: 8
 *   --geo            Embed EXIF GPS so images appear on the map view. Spread
 *                    across a handful of world cities, and at each city a mix of
 *                    exactly-colocated, tightly-clustered, and spread-out points
 *                    so the map exercises cluster-split AND spiderfy. The geo
 *                    enricher reads GPS via exifr, so these flow into Meili.
 *   --clean          Remove existing <prefix>-* album dirs under --out first.
 *   -h, --help       Show this help.
 *
 * Examples:
 *   node scripts/gen-test-albums.js                       # 5 albums x 400
 *   node scripts/gen-test-albums.js --counts 300,450,600  # 3 albums, varied
 *   node scripts/gen-test-albums.js --clean --albums 8 --count 250
 *   node scripts/gen-test-albums.js --geo                 # geotagged, for map
 *
 * Cleanup: every album dir is named "<prefix>-NN", so to remove them:
 *   rm -rf debug-data/pics/test-album-*
 * (or re-run with --clean).
 */

const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

// --- arg parsing ------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    out: 'debug-data/pics',
    albums: 5,
    count: 400,
    counts: null,
    prefix: 'test-album',
    size: 512,
    months: 6,
    start: '2026-01-01',
    concurrency: 8,
    clean: false,
    geo: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case '-h':
      case '--help':
        printHelp()
        process.exit(0)
        break
      case '--out':
        opts.out = next()
        break
      case '--albums':
        opts.albums = parseInt(next(), 10)
        break
      case '--count':
        opts.count = parseInt(next(), 10)
        break
      case '--counts':
        opts.counts = next()
          .split(',')
          .map((n) => parseInt(n.trim(), 10))
        break
      case '--prefix':
        opts.prefix = next()
        break
      case '--size':
        opts.size = parseInt(next(), 10)
        break
      case '--months':
        opts.months = parseInt(next(), 10)
        break
      case '--start':
        opts.start = next()
        break
      case '--concurrency':
        opts.concurrency = parseInt(next(), 10)
        break
      case '--clean':
        opts.clean = true
        break
      case '--geo':
        opts.geo = true
        break
      default:
        console.error(`Unknown option: ${a}\n`)
        printHelp()
        process.exit(1)
    }
  }
  return opts
}

function printHelp() {
  // The big block comment above is the canonical doc; print a short version.
  const lines = fs.readFileSync(__filename, 'utf8').split('\n').slice(2) // skip shebang + vim modeline
  const start = lines.findIndex((l) => l.includes('Usage:'))
  const end = lines.findIndex((l, i) => i > start && l.includes('*/'))
  console.log(
    lines
      .slice(start, end)
      .map((l) => l.replace(/^\s?\*\s?/, ''))
      .join('\n')
  )
}

// --- date / color helpers ---------------------------------------------------

// Capture date for image `i` of `count`, spread across `months` months starting
// at `start`. Strictly increasing in `i` so sequence order == date order.
function captureDateFor(i, count, months, start) {
  const spanMs = months * 30 * 24 * 60 * 60 * 1000
  // step so the last image lands ~one step before `start + spanMs`.
  const step = spanMs / Math.max(count, 1)
  return new Date(start.getTime() + Math.floor(i * step))
}

// EXIF DateTimeOriginal format: "YYYY:MM:DD HH:MM:SS" (local components).
function exifDate(d) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}

function isoDay(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Pick black or white text for legibility over an HSL background.
function textColorForHsl(lPercent) {
  return lPercent > 55 ? '#111' : '#fff'
}

function esc(s) {
  return String(s).replace(
    /[<&>]/g,
    (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' })[c]
  )
}

// --- geo (EXIF GPS) helpers -------------------------------------------------

// A handful of real cities so the offline reverse-geocoder resolves place
// names, spread over the globe so the world view shows several distinct
// clusters. ~degree separation is far larger than any in-city jitter below.
const HOTSPOTS = [
  { name: 'San Francisco', lat: 37.7749, lng: -122.4194 },
  { name: 'New York', lat: 40.7128, lng: -74.006 },
  { name: 'London', lat: 51.5074, lng: -0.1278 },
  { name: 'Paris', lat: 48.8566, lng: 2.3522 },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503 },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093 },
  { name: 'Rio de Janeiro', lat: -22.9068, lng: -43.1729 },
  { name: 'Cairo', lat: 30.0444, lng: 31.2357 },
]

// Deterministic [0,1) pseudo-random from an integer seed (reproducible runs).
function rand(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

// Assign image `i` a coordinate. Each image lands at one hotspot, then one of
// three jitter regimes so every hotspot accumulates all three (and the map gets
// all three behaviours):
//   - colocated: exact hotspot center      -> can't split by zoom -> spiderfy
//   - tight:     ~10 m jitter              -> splits only at the deepest zoom
//   - spread:    ~up to ~2 km jitter       -> splits at normal city zoom
// Cycling the hotspot by (i + albumIdx) spreads each album across all cities.
function geoFor(albumIdx, i) {
  const h = HOTSPOTS[(i + albumIdx) % HOTSPOTS.length]
  const regime = i % 3 // 0 colocated, 1 tight, 2 spread (even thirds)
  const radiusDeg = regime === 0 ? 0 : regime === 1 ? 0.0001 : 0.02
  const dLat = (rand(i * 2 + 1) * 2 - 1) * radiusDeg
  const dLng = (rand(i * 2 + 7) * 2 - 1) * radiusDeg
  return { lat: h.lat + dLat, lng: h.lng + dLng, place: h.name }
}

// Decimal degrees -> EXIF rational DMS string "deg/1 min/1 sec*1e4/1e4".
function toDmsRational(deg) {
  const a = Math.abs(deg)
  const d = Math.floor(a)
  const mFloat = (a - d) * 60
  const m = Math.floor(mFloat)
  const s = (mFloat - m) * 60
  return `${d}/1 ${m}/1 ${Math.round(s * 10000)}/10000`
}

// EXIF GPS sub-IFD (sharp "IFD3"); read back by exifr.gps() in the enricher.
function gpsExif({ lat, lng }) {
  return {
    GPSLatitudeRef: lat >= 0 ? 'N' : 'S',
    GPSLatitude: toDmsRational(lat),
    GPSLongitudeRef: lng >= 0 ? 'E' : 'W',
    GPSLongitude: toDmsRational(lng),
  }
}

// --- image generation -------------------------------------------------------

function cellSvg({ size, hue, seq, total, album, dateStr, place }) {
  const light = 55
  const bg = `hsl(${hue}, 65%, ${light}%)`
  const fg = textColorForHsl(light)
  const sub = textColorForHsl(light) === '#fff' ? '#eee' : '#222'
  const num = String(seq).padStart(String(total).length, '0')
  const placeLine = place
    ? `<text x="50%" y="${Math.round(size * 0.95)}" font-family="Helvetica, Arial, sans-serif"
            font-size="${Math.round(size * 0.06)}" fill="${sub}"
            text-anchor="middle">${esc(place)}</text>`
    : ''
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" fill="${bg}"/>
      <rect x="4" y="4" width="${size - 8}" height="${size - 8}" fill="none"
            stroke="${fg}" stroke-width="3" opacity="0.5"/>
      <text x="50%" y="50%" font-family="Helvetica, Arial, sans-serif"
            font-size="${Math.round(size * 0.34)}" font-weight="700"
            fill="${fg}" text-anchor="middle" dominant-baseline="central">#${num}</text>
      <text x="50%" y="${Math.round(size * 0.16)}" font-family="Helvetica, Arial, sans-serif"
            font-size="${Math.round(size * 0.075)}" fill="${sub}"
            text-anchor="middle">${esc(album)}</text>
      <text x="50%" y="${Math.round(size * 0.88)}" font-family="Helvetica, Arial, sans-serif"
            font-size="${Math.round(size * 0.09)}" fill="${sub}"
            text-anchor="middle">${esc(dateStr)}</text>
      ${placeLine}
    </svg>`
  )
}

async function writeCell(file, { size, hue, seq, total, album, date, geo }) {
  const svg = cellSvg({
    size,
    hue,
    seq,
    total,
    album,
    dateStr: isoDay(date),
    place: geo && geo.place,
  })
  let pipeline = sharp(svg)
    .jpeg({ quality: 80 })
    // Sharp's "IFD2" block is the EXIF sub-IFD (read back as `Photo` by
    // exif-reader). DateTimeOriginal there is the canonical capture date.
    .withExif({
      IFD2: { DateTimeOriginal: exifDate(date) },
      // "IFD3" is the GPS sub-IFD; only included when geotagging.
      ...(geo ? { IFD3: gpsExif(geo) } : {}),
    })
  const buf = await pipeline.toBuffer()
  await fs.promises.writeFile(file, buf)
  // Match the file mtime to the capture date (what the gallery sorts on today).
  await fs.promises.utimes(file, date, date)
}

// tiny concurrency-limited map
async function mapLimit(items, limit, fn) {
  const ret = new Array(items.length)
  let idx = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (idx < items.length) {
        const cur = idx++
        ret[cur] = await fn(items[cur], cur)
      }
    }
  )
  await Promise.all(workers)
  return ret
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const startDate = new Date(opts.start + 'T09:00:00')
  if (isNaN(startDate.getTime())) {
    console.error(`Invalid --start date: ${opts.start}`)
    process.exit(1)
  }

  const counts =
    opts.counts || Array.from({ length: opts.albums }, () => opts.count)
  const outRoot = path.resolve(opts.out)

  if (opts.clean) {
    let existing = []
    try {
      existing = fs.readdirSync(outRoot)
    } catch (_) {
      /* missing dir is fine */
    }
    for (const name of existing) {
      if (name.startsWith(opts.prefix + '-')) {
        fs.rmSync(path.join(outRoot, name), { recursive: true, force: true })
        console.log(`removed ${name}`)
      }
    }
  }

  await fs.promises.mkdir(outRoot, { recursive: true })

  const t0 = Date.now()
  let grandTotal = 0
  for (let a = 0; a < counts.length; a++) {
    const total = counts[a]
    const album = `${opts.prefix}-${String(a + 1).padStart(2, '0')}`
    const albumDir = path.join(outRoot, album)
    await fs.promises.mkdir(albumDir, { recursive: true })

    const seqs = Array.from({ length: total }, (_, i) => i)
    let done = 0
    await mapLimit(seqs, opts.concurrency, async (i) => {
      const date = captureDateFor(i, total, opts.months, startDate)
      // Hue sweeps 0..330 across the album so order reads as a color gradient.
      const hue = Math.round((i / Math.max(total - 1, 1)) * 330)
      const seq = i + 1
      const name = `${String(seq).padStart(String(total).length, '0')}_${isoDay(date)}.jpg`
      const geo = opts.geo ? geoFor(a, i) : null
      await writeCell(path.join(albumDir, name), {
        size: opts.size,
        hue,
        seq,
        total,
        album,
        date,
        geo,
      })
      if (++done % 100 === 0 || done === total) {
        process.stdout.write(`\r  ${album}: ${done}/${total}`)
      }
    })
    process.stdout.write('\n')
    grandTotal += total
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(
    `\nDone: ${grandTotal} images across ${counts.length} albums in ${secs}s`
  )
  console.log(`Output: ${outRoot}`)
  console.log(
    `Cleanup: rm -rf ${path.join(opts.out, opts.prefix + '-*')}  (or re-run with --clean)`
  )
}

main().catch((err) => {
  console.error('\nFailed:', err.message)
  process.exit(1)
})
