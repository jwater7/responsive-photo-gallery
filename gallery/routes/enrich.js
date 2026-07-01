// vim: tabstop=2 shiftwidth=2 expandtab
//
// Isolated proxy + runtime feature flags for the image-enrichment service.
//
// This whole feature (map + semantic search UI) is removable by deleting this
// file and its single mount line in app.js. The browser stays same-origin; the
// gallery never depends on the enrichment plane for normal operation.

const express = require('express')
const runtimeConfig = require('rpg-config')

const ENRICH_URL =
  process.env.ENRICH_URL || 'http://rpg-enrichment-indexer:8080'

const router = express.Router()

// Outbound headers for calls into the enrichment API. Carries the shared secret
// (auto-generated + cached by the gallery at startup) when one is configured, so
// the enrichment service can verify the request came from us. Omitted when no
// secret exists (fail-open / optional). /health is probed without it (left open).
function enrichHeaders() {
  const secret = runtimeConfig.getEnrichSecret()
  return {
    'Content-Type': 'application/json',
    ...(secret && { 'X-Enrich-Secret': secret }),
  }
}

// Health probe with hysteresis. The indexer shares one event loop with its
// enrichment worker, so while it's processing (CLIP/OCR — measured ~3-4s/image)
// a /health response is delayed until the loop frees between images. A single
// slow probe must NOT tear the feature flags down — that produced visible
// flapping in lockstep with enrichment work. So:
//   - generous timeout (> the per-image block, with margin) so the probe waits
//     out a busy stretch and resolves instead of aborting,
//   - report degraded only after several CONSECUTIVE failures, recover on the
//     first success.
// Cached briefly so /features (via /ping) stays cheap.
const HEALTH_TTL_MS = 5000
const HEALTH_TIMEOUT_MS = 8000
const HEALTH_FAIL_THRESHOLD = 3
let healthCache = { ok: false, at: 0, failStreak: 0 }

async function probeHealthOnce() {
  try {
    const r = await fetch(ENRICH_URL + '/health', {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return r.ok
  } catch (_) {
    return false
  }
}

async function enrichHealthy() {
  const now = Date.now()
  if (now - healthCache.at < HEALTH_TTL_MS) return healthCache.ok
  const probeOk = await probeHealthOnce()
  let { ok, failStreak } = healthCache
  if (probeOk) {
    ok = true
    failStreak = 0
  } else {
    failStreak += 1
    // Only flip to degraded after sustained failure; ride out transient blips
    // (a busy indexer mid-inference) by keeping the previous value.
    if (failStreak >= HEALTH_FAIL_THRESHOLD) ok = false
  }
  healthCache = { ok, at: now, failStreak }
  return ok
}

// Runtime feature flags. Default ON, but turned OFF automatically when the
// enrichment service is unreachable (degraded operation), or explicitly via
// FEATURE_MAP=off / FEATURE_SEARCH=off. Exported so the core /ping heartbeat can
// fold these into one bootstrap response (see routes/api.js) without the gallery
// importing any enrichment library — this stays a fail-soft HTTP probe.
async function computeFeatures() {
  const healthy = await enrichHealthy()
  return {
    features: {
      map: process.env.FEATURE_MAP !== 'off' && healthy,
      search: process.env.FEATURE_SEARCH !== 'off' && healthy,
    },
    degraded: !healthy,
  }
}

router.get('/features', async (req, res) => {
  res.json(await computeFeatures())
})

// Thin proxy to the enrichment API. Only the endpoints the UI needs are exposed.
async function forward(req, res, targetPath) {
  try {
    const r = await fetch(ENRICH_URL + targetPath, {
      method: req.method,
      headers: enrichHeaders(),
      body: ['POST', 'PUT'].includes(req.method)
        ? JSON.stringify(req.body || {})
        : undefined,
      signal: AbortSignal.timeout(15000),
    })
    const data = await r.json().catch(() => ({}))
    res.status(r.status).json(data)
  } catch (_) {
    res
      .status(503)
      .json({ error: { code: 503, message: 'enrichment service unavailable' } })
  }
}

router.post('/search', (req, res) => forward(req, res, '/api/v1/search'))
// Map density: true photo count per H3 cell for a viewport (the map's primary
// data source — replaces sampled client-side clustering).
router.post('/geo-density', (req, res) => forward(req, res, '/api/v1/geo-density'))
router.post('/geo', (req, res) => forward(req, res, '/api/v1/geo'))
router.get('/status', (req, res) => forward(req, res, '/api/v1/status'))
// Admin: one-shot enrichment coverage snapshot (counts of docs with embeddings,
// OCR, geo, etc). Cheap index-metadata read on the indexer side — non-blocking,
// does not touch the worker.
router.get('/index-stats', (req, res) =>
  forward(req, res, '/api/v1/index-stats')
)
// Admin: on-demand OCR quality report (content yield + confidence + failures).
// Heavier than index-stats (scans every doc's OCR fields), so the admin page
// puts it behind its own button rather than polling it.
router.get('/ocr-stats', (req, res) => forward(req, res, '/api/v1/ocr-stats'))
// Admin: read-only view of the enrichment service's effective (non-secret) env
// config. Cheap local read; no write path (config is compose-set, not runtime).
router.get('/config', (req, res) => forward(req, res, '/api/v1/config'))
// Admin: trigger a (re)scan/enrichment pass. Non-blocking on the indexer side
// (returns immediately); progress is observed via /status.
router.post('/enrichment-sync', (req, res) =>
  forward(req, res, '/api/v1/enrichment-sync')
)
// Admin: reap orphaned/stale index docs (deleted or edited-away photos).
// Non-blocking on the indexer side; result observed via /status (`lastReap`).
router.post('/reap', (req, res) => forward(req, res, '/api/v1/reap'))

// Server-side fire-and-forget reap trigger, used by the excludes PUT handler so
// that newly-excluded paths' index docs drop out as orphans on the next reap
// (the worker's walk now skips them, so they leave the `present` set). Exposed
// here to keep ENRICH_URL ownership in the proxy; the caller ignores the result.
function triggerReap() {
  return fetch(ENRICH_URL + '/api/v1/reap', {
    method: 'POST',
    headers: enrichHeaders(),
    body: '{}',
    signal: AbortSignal.timeout(15000),
  })
}

module.exports = router
module.exports.computeFeatures = computeFeatures
module.exports.triggerReap = triggerReap
