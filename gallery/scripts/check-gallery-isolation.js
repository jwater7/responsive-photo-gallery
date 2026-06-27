#!/usr/bin/env node
// vim: tabstop=2 shiftwidth=2 expandtab
'use strict'

/**
 * Graceful-degradation guard: the gallery's hot path must never import the
 * enrichment plane (search index, queue, ML, geo, or the enrichment service
 * code). The gallery talks to enrichment ONLY via the HTTP proxy in
 * routes/enrich.js, which fails soft — so the gallery keeps working when the
 * enrichment plane is down.
 *
 * Run: npm run test:isolation
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SCAN_DIRS = ['routes', 'handlers', 'lib']
const SCAN_FILES = ['app.js', 'bin/www']

const FORBIDDEN = [
  { re: /require\(\s*['"]meilisearch['"]/, what: 'meilisearch' },
  { re: /require\(\s*['"]bullmq['"]/, what: 'bullmq' },
  { re: /require\(\s*['"]ioredis['"]/, what: 'ioredis' },
  {
    re: /require\(\s*['"]@huggingface\/transformers['"]/,
    what: 'transformers',
  },
  { re: /require\(\s*['"]exifr['"]/, what: 'exifr' },
  { re: /require\(\s*['"][^'"]*tesseract[^'"]*['"]/, what: 'tesseract' },
  {
    re: /require\(\s*['"][.][.]?\/enrichment\//,
    what: 'enrichment service code (./enrichment)',
  },
]

function walk(dir, acc) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (_) {
    return acc
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name.endsWith('.js')) acc.push(p)
  }
  return acc
}

const files = []
for (const f of SCAN_FILES) {
  const p = path.join(ROOT, f)
  if (fs.existsSync(p)) files.push(p)
}
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files)

const violations = []
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const { re, what } of FORBIDDEN) {
      if (re.test(line)) {
        violations.push(`  ${path.relative(ROOT, f)}:${i + 1} imports ${what}`)
      }
    }
  })
}

if (violations.length) {
  console.error('FAIL: gallery hot path must not import the enrichment plane:')
  console.error(violations.join('\n'))
  console.error(
    '\nTalk to enrichment only via the HTTP proxy (routes/enrich.js), which fails soft.'
  )
  process.exit(1)
}

console.log(
  `OK: gallery isolation verified (${files.length} files scanned, no enrichment-plane imports).`
)
