// vim: tabstop=2 shiftwidth=2 expandtab
//
// rpg-config — the single home for responsive-photo-gallery runtime config.
//
// Owns CONFIG_PATH (the root for persisted, non-photo state) and the patterns for
// reading/writing it. Used by BOTH planes, which have different access needs:
//
//   - WRITERS (the gallery + jwt-user-auth): node-json-db stores under CONFIG_PATH
//     — `openDb()` for keyed config files (auth's config.json), and
//     getExcludes/setExcludes for the directory-exclude list. saveOnPush +
//     humanReadable, one DB file per concern.
//
//   - READERS that are a separate process from the writer (the enrichment worker,
//     which sees CONFIG_PATH read-only over a bind mount): `loadExcludes()` /
//     `readConfigFile()` do a fresh, FAIL-OPEN raw read — never node-json-db,
//     whose in-memory cache would hide the gallery's cross-process writes. Any
//     error (missing mount, partial write mid-swap, bad JSON) yields the fallback
//     (for excludes that means "exclude nothing", never "hide everything").
//
// node-json-db is lazy-required inside the writer path, so a pure read-only
// consumer never loads it. The two planes share this package but stay otherwise
// import-isolated; only the file format (a JSON object `{ excludes: [...] }` of
// normalized POSIX paths) crosses between them.

'use strict'

const fs = require('fs')
const path = require('path')

const debug = require('debug')('rpg-config')
const debugErr = require('debug')('rpg-config:error')
debugErr.enabled = true // errors are always-on, not gated by DEBUG

const CONFIG_PATH = process.env.CONFIG_PATH || '/data/config'

// Where auth lived before CONFIG_PATH existed. Overridable so the auto-migration
// can be exercised against a non-default layout (dev/tests point this at a
// debug-data path); defaults to the old prod default.
const LEGACY_AUTH_PATH = process.env.LEGACY_AUTH_PATH || '/data/auth'

const EXCLUDES_FILE = path.join(CONFIG_PATH, 'excludes.json')

// Defense-in-depth shared secret between the gallery (writer) and the enrichment
// API (reader). Same writer/reader split as excludes: the gallery generates +
// persists it here, the enrichment service does a fresh fail-open raw read.
const ENRICH_SECRET_FILE = path.join(CONFIG_PATH, 'enrich-secret.json')

// AUTH_PATH (if explicitly set) always wins; otherwise auth defaults under
// CONFIG_PATH. node-json-db creates the parent dir for the fresh case.
function authPath() {
  return process.env.AUTH_PATH || path.join(CONFIG_PATH, 'auth')
}

// One-time, idempotent: if the resolved auth dir has no config.json but a legacy
// auth config.json is visible, copy it once so the same admin login + JWT key
// survive the CONFIG_PATH move (no fresh password). Plain file copy — runs before
// any DB is opened. Best effort: a failure is logged and boot continues.
async function migrateLegacyAuth() {
  const target = authPath()
  const targetConfig = path.join(target, 'config.json')
  const legacyConfig = path.join(LEGACY_AUTH_PATH, 'config.json')

  try {
    await fs.promises.access(targetConfig)
    return // already migrated / fresh-with-config
  } catch (_) {
    /* target config absent; consider the legacy copy */
  }

  if (path.resolve(target) === path.resolve(LEGACY_AUTH_PATH)) return
  try {
    await fs.promises.access(legacyConfig)
  } catch (_) {
    return // no legacy config to copy
  }

  try {
    await fs.promises.mkdir(target, { recursive: true })
    await fs.promises.copyFile(legacyConfig, targetConfig)
    debug('migrated legacy auth config: %s -> %s', legacyConfig, targetConfig)
  } catch (err) {
    debugErr('legacy auth migration failed: %s', err.message)
  }
}

// Normalize an exclude list into the canonical on-disk form: POSIX relative
// paths, no leading/trailing slash, no '.'/'..' segments, deduped. The ONLY place
// normalization happens (the write path); both planes then consume normalized
// entries.
function normalize(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const parts = raw
      .replace(/\\/g, '/')
      .split('/')
      .filter((s) => s && s !== '.' && s !== '..')
    if (!parts.length) continue
    const norm = parts.join('/')
    if (!seen.has(norm)) {
      seen.add(norm)
      out.push(norm)
    }
  }
  return out
}

// Directory-prefix match: an entry hides itself and everything beneath it.
// `relPath` is POSIX, relative to IMAGE_PATH; `excludes` is already normalized.
// ("work" excludes "work" and "work/scans" but NOT "workshop".)
function isExcluded(relPath, excludes) {
  if (!relPath || !excludes || !excludes.length) return false
  const p = relPath.replace(/\\/g, '/')
  return excludes.some((e) => p === e || p.startsWith(e + '/'))
}

// ---- writer side (node-json-db; lazy require) ------------------------------

// Open a node-json-db store at `absFile`. saveOnPush + humanReadable, '/'
// separator — the convention every gallery-owned config file follows (auth's
// config.json opens through here too). node-json-db is required lazily so a
// read-only consumer that never writes doesn't load it.
function openDb(absFile, { humanReadable = true } = {}) {
  const { JsonDB, Config } = require('node-json-db')
  return new JsonDB(new Config(absFile, true, humanReadable, '/'))
}

let _excludesDb = null
function excludesDb() {
  if (!_excludesDb) _excludesDb = openDb(EXCLUDES_FILE)
  return _excludesDb
}

// Writer-side read of the exclude list: served from node-json-db's in-memory copy
// (authoritative in the writer process = the gallery). [] on a fresh/absent file.
async function getExcludes() {
  try {
    return normalize(await excludesDb().getData('/excludes'))
  } catch (_) {
    return []
  }
}

// Normalize -> dedupe -> persist (saveOnPush writes the file). Returns the
// normalized list actually persisted.
async function setExcludes(list) {
  const normalized = normalize(list)
  await excludesDb().push('/excludes', normalized)
  return normalized
}

// ---- enrichment shared secret: writer side (gallery) -----------------------

// Generated once and cached in-process for sync reads by the enrich proxy. The
// gallery is a single process (bin/www: createApp().then(listen)), so the
// generate-if-absent below cannot race itself. NOTE: running multiple gallery
// processes/containers against one CONFIG_PATH would reintroduce a generate
// race (two distinct secrets, last-write-wins, the loser's header then 401s) —
// out of scope for the current single-instance deployment.
let _enrichSecret = null
let _enrichSecretDb = null
function enrichSecretDb() {
  if (!_enrichSecretDb) _enrichSecretDb = openDb(ENRICH_SECRET_FILE)
  return _enrichSecretDb
}

// Idempotent generate-if-absent: read the persisted secret, or mint a strong one
// and persist it (saveOnPush writes the file). Returns the secret (or null).
// Written once, ever — never rewritten in steady state. Call once at gallery
// startup. BEST-EFFORT: this is an optional defense-in-depth layer, so a
// persist failure (e.g. CONFIG_PATH not writable) leaves the secret null and the
// gate off rather than failing the gallery's boot.
async function ensureEnrichSecret() {
  try {
    _enrichSecret = await enrichSecretDb().getData('/secret')
    return _enrichSecret
  } catch (_) {
    /* not yet generated — mint + persist below */
  }
  try {
    const crypto = require('crypto') // lazy: the read-only reader never loads it
    const secret = crypto.randomBytes(32).toString('base64')
    await enrichSecretDb().push('/secret', secret)
    _enrichSecret = secret
  } catch (err) {
    debugErr('enrich secret persist failed (gate stays off): %s', err.message)
    _enrichSecret = null
  }
  return _enrichSecret
}

// Sync accessor for the value cached by ensureEnrichSecret(). null until that
// has run (which it does before the gallery serves any request).
function getEnrichSecret() {
  return _enrichSecret
}

// ---- reader side (raw, fail-open; for cross-process read-only consumers) ----

// Fresh JSON read of a config file. Fail-open: any error returns `fallback`.
function readConfigFile(absFile, fallback) {
  try {
    return JSON.parse(fs.readFileSync(absFile, 'utf8'))
  } catch (_) {
    return fallback
  }
}

// The exclude list as the enrichment plane sees it: fresh raw read each call (so
// the file stays the single source of truth across worker/Redis restarts),
// fail-open to [].
function loadExcludes() {
  const data = readConfigFile(EXCLUDES_FILE, null)
  return data && Array.isArray(data.excludes) ? data.excludes : []
}

// The enrichment shared secret as the enrichment plane sees it: fresh raw read
// each call (so the gallery's first write is picked up without a restart),
// fail-open to null. null means "no secret configured" → the gate is a
// passthrough (defense-in-depth, never fails closed against its own absence).
function loadEnrichSecret() {
  const data = readConfigFile(ENRICH_SECRET_FILE, null)
  return data && typeof data.secret === 'string' ? data.secret : null
}

module.exports = {
  CONFIG_PATH,
  EXCLUDES_FILE,
  ENRICH_SECRET_FILE,
  authPath,
  migrateLegacyAuth,
  normalize,
  isExcluded,
  openDb,
  getExcludes,
  setExcludes,
  ensureEnrichSecret,
  getEnrichSecret,
  readConfigFile,
  loadExcludes,
  loadEnrichSecret,
}
