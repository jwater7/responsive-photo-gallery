// vim: tabstop=2 shiftwidth=2 expandtab
//
// API client for the image-enrichment proxy (/api/v1/enrich/*, behind the same
// auth gate as the rest of the API). Kept separate from lib/api.js so the whole
// map/search feature is self-contained and removable; the prefix derivation and
// fetch/error plumbing are shared via lib/api-base.js. Every helper returns the
// full parsed response body and throws a uniform Error (carrying the server's
// message when there is one) on failure.

import { ENRICH_PREFIX, apiFetch } from './api-base'

// NOTE: feature flags are no longer fetched here — they ride along on the /ping
// auth heartbeat (see lib/api.js `ping` + data/use-ping.js), so the client
// bootstraps auth + flags in a single request. The /api/v1/enrich/features route
// still exists server-side for direct/debug use.

// Search with optional text query, geo bounding box, and date range.
export const geoSearch = (body) =>
  apiFetch(ENRICH_PREFIX + '/search', { method: 'POST', body }, 'search failed')

// Server-side map density: true photo count per H3 cell for a viewport (no
// sampling). Body: { geoBoundingBox, resolution, excludeInferred? }. Returns
// { resolution, total, cells: [{ cell, count, center:{lat,lng}, hexagon:[[lat,lng]] }] }.
export const geoDensity = (body) =>
  apiFetch(ENRICH_PREFIX + '/geo-density', { method: 'POST', body }, 'density failed')

// Admin: current enrichment status (queue depth, in-progress, next scan).
export const getEnrichStatus = () =>
  apiFetch(ENRICH_PREFIX + '/status', {}, 'status fetch failed')

// Admin: one-shot enrichment coverage snapshot (how many docs have embeddings,
// OCR, geo, etc). Cheap index-metadata read; safe to call mid-scan and not
// polled — the admin page fetches it on an explicit button press.
export const getEnrichIndexStats = () =>
  apiFetch(ENRICH_PREFIX + '/index-stats', {}, 'index-stats fetch failed')

// Admin: on-demand OCR quality report — content yield (real text vs empty),
// confidence distribution, version stamps, and the failure list. Heavier than
// the coverage snapshot (it scans every doc's OCR fields), so it's behind its
// own button and not polled. Read-only; safe to call mid-scan.
export const getEnrichOcrStats = () =>
  apiFetch(ENRICH_PREFIX + '/ocr-stats', {}, 'ocr-stats fetch failed')

// Admin: read-only view of the enrichment service's effective (non-secret) env
// configuration, grouped by category. Config is compose-set (not changeable at
// runtime), so this is display-only — there is no write path.
export const getEnrichConfig = () =>
  apiFetch(ENRICH_PREFIX + '/config', {}, 'config fetch failed')

// Admin: trigger a (re)scan/enrichment pass. Non-blocking — returns immediately;
// poll getEnrichStatus() to watch progress. `type` is "full" (default) or "delta".
// Optional `force` (true | enricher-name list) re-runs enrichers on up-to-date
// docs; optional `path` scopes the scan to an album / sub-folder / file.
export const triggerEnrichmentSync = (type = 'full', { force, path } = {}) =>
  apiFetch(
    ENRICH_PREFIX + '/enrichment-sync',
    {
      method: 'POST',
      body: {
        type,
        ...(force ? { force } : {}),
        ...(path ? { path } : {}),
      },
    },
    'enrichment-sync failed'
  )

// Admin: reap orphaned/stale index docs (deleted or edited-away photos).
// Non-blocking — returns immediately; poll getEnrichStatus() (`lastReap`).
export const triggerReap = () =>
  apiFetch(ENRICH_PREFIX + '/reap', { method: 'POST', body: {} }, 'reap failed')

// Admin: delete the retained FAILED Meili task history so the failedTasks health
// signal resets after the underlying cause is fixed. Async on the Meili side
// (a taskDeletion task) — re-fetch getEnrichIndexStats() afterward to confirm
// the count dropped.
export const clearEnrichFailedTasks = () =>
  apiFetch(
    ENRICH_PREFIX + '/clear-failed-tasks',
    { method: 'POST', body: {} },
    'clear-failed-tasks failed'
  )
