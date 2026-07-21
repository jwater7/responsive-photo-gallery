#!/usr/bin/env node
// vim: tabstop=2 shiftwidth=2 expandtab
'use strict'

/*
 * gen-map-fixtures.js — dedicated map fixtures for the Playwright e2e suite.
 *
 * The big `gen-test-albums.js --geo` hotspots pile 90+ photos on one coordinate,
 * so they always exceed CELL_THUMB_LIMIT (60) and render as a dense COUNT BUBBLE
 * at every zoom. That never exercises the sparse (2..60) path — the case a real
 * user hit: a small handful of photos sharing one GPS fix that, at the deepest
 * zoom, stacked exactly on top of each other so all but the top one were hidden
 * (the cell said "6", the map showed 3).
 *
 * This writes ONE small album that reproduces exactly that: 3 spots ~40 m apart
 * near Reykjavik, 2 EXACTLY-colocated photos at each spot (distinct content, so
 * distinct hashes — same coordinate). Behaviour it drives:
 *   - mid zoom  (circle): all 6 fall in one H3 cell -> a single "6" circle whose
 *     popup lists 6 photos.
 *   - deep zoom (thumbnail): the 3 spots separate into 3 markers, each a pile of
 *     2 -> each must render ONE badged thumbnail ("2"), not two stacked/hidden.
 *
 * Colocation is exact: both photos at a spot get the same lat/lng, so the GPS
 * EXIF round-trips to an identical `_geo` and they group into one pile.
 *
 * Usage (from gallery/, where `sharp` resolves):
 *   node scripts/gen-map-fixtures.js            # -> debug-data/pics/test-colocated-small
 * Then index the new path (scoped, fast):
 *   curl -s -X POST localhost:8000/.../enrichment-sync -d '{"type":"delta","path":"test-colocated-small"}'
 * or Admin -> Full scan. See README "Generating test images".
 */

const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const OUT_ROOT = path.resolve(__dirname, '../../debug-data/pics')
const ALBUM = 'test-colocated-small'
const PLACE = 'Reykjavik'
const SIZE = 512

// 3 spots ~40 m apart (far enough to be distinct markers at the deepest zoom,
// close enough to share one cell at mid zoom). At lat ~64, 0.0009° lng ≈ 44 m.
const BASE = { lat: 64.1466, lng: -21.9426 }
const SPOTS = [
  { lat: BASE.lat, lng: BASE.lng },
  { lat: BASE.lat + 0.0004, lng: BASE.lng }, // ~44 m north
  { lat: BASE.lat, lng: BASE.lng + 0.0009 }, // ~44 m east
]
const PER_SPOT = 2 // EXACTLY colocated -> a pile of 2 at each spot

// Decimal degrees -> EXIF rational DMS "deg/1 min/1 sec*1e4/1e4" (as gen-test-albums.js).
function toDmsRational(deg) {
  const a = Math.abs(deg)
  const d = Math.floor(a)
  const mFloat = (a - d) * 60
  const m = Math.floor(mFloat)
  const s = (mFloat - m) * 60
  return `${d}/1 ${m}/1 ${Math.round(s * 10000)}/10000`
}

function gpsExif({ lat, lng }) {
  return {
    GPSLatitudeRef: lat >= 0 ? 'N' : 'S',
    GPSLatitude: toDmsRational(lat),
    GPSLongitudeRef: lng >= 0 ? 'E' : 'W',
    GPSLongitude: toDmsRational(lng),
  }
}

function cellSvg(seq, hue) {
  const bg = `hsl(${hue}, 65%, 55%)`
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
      <rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>
      <text x="50%" y="50%" font-family="Helvetica, Arial, sans-serif"
            font-size="${Math.round(SIZE * 0.34)}" font-weight="700"
            fill="#fff" text-anchor="middle" dominant-baseline="central">#${seq}</text>
      <text x="50%" y="16%" font-family="Helvetica, Arial, sans-serif"
            font-size="${Math.round(SIZE * 0.07)}" fill="#eee"
            text-anchor="middle">${ALBUM}</text>
      <text x="50%" y="88%" font-family="Helvetica, Arial, sans-serif"
            font-size="${Math.round(SIZE * 0.06)}" fill="#eee"
            text-anchor="middle">${PLACE}</text>
    </svg>`
  )
}

async function main() {
  const dir = path.join(OUT_ROOT, ALBUM)
  await fs.promises.mkdir(dir, { recursive: true })

  let seq = 0
  for (let s = 0; s < SPOTS.length; s++) {
    for (let k = 0; k < PER_SPOT; k++) {
      seq++
      const hue = Math.round((seq / (SPOTS.length * PER_SPOT)) * 330)
      const buf = await sharp(cellSvg(seq, hue))
        .jpeg({ quality: 80 })
        .withExif({ IFD3: gpsExif(SPOTS[s]) })
        .toBuffer()
      const name = `spot${s + 1}_${String(seq).padStart(2, '0')}.jpg`
      await fs.promises.writeFile(path.join(dir, name), buf)
    }
  }
  console.log(`wrote ${seq} images to ${dir}`)
  console.log(`  ${SPOTS.length} spots x ${PER_SPOT} colocated; deep-link: /map?lat=${BASE.lat}&lng=${BASE.lng}`)
}

main().catch((err) => {
  console.error('Failed:', err.message)
  process.exit(1)
})
