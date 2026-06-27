// vim: tabstop=2 shiftwidth=2 expandtab
//
// API client for the image-enrichment proxy (/api/v1/enrich/*, behind the same
// auth gate as the rest of the API). Kept separate from lib/api.js so the whole
// map/search feature is self-contained and removable.

// Mirror lib/api.js prefix derivation, but target the enrich proxy.
let base_prefix = '/';
if (process.env.PUBLIC_URL) {
  base_prefix = process.env.PUBLIC_URL;
  if (base_prefix.substr(-1) !== '/') base_prefix += '/';
}
if (process.env.NEXT_PUBLIC_BASENAME) {
  base_prefix = process.env.NEXT_PUBLIC_BASENAME;
  if (base_prefix.substr(-1) !== '/') base_prefix += '/';
}
let prefix = base_prefix || '';
if (process.env.NEXT_PUBLIC_API_PREFIX) {
  prefix = process.env.NEXT_PUBLIC_API_PREFIX;
  if (process.env.NEXT_PUBLIC_API_PREFIX_OVERRIDE) {
    prefix = process.env.NEXT_PUBLIC_API_PREFIX_OVERRIDE;
  }
  if (prefix.substr(-1) !== '/') prefix += '/';
}
prefix += 'api/v1/enrich';

// NOTE: feature flags are no longer fetched here — they ride along on the /ping
// auth heartbeat (see lib/api.js `ping` + data/use-ping.js), so the client
// bootstraps auth + flags in a single request. The /api/v1/enrich/features route
// still exists server-side for direct/debug use.

// Search with optional text query, geo bounding box, and date range.
export const geoSearch = async (body) => {
  const res = await fetch(prefix + '/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('search failed');
  return res.json();
};

// Admin: current enrichment status (queue depth, in-progress, next scan).
export const getEnrichStatus = async () => {
  const res = await fetch(prefix + '/status');
  if (!res.ok) throw new Error('status fetch failed');
  return res.json();
};

// Admin: one-shot enrichment coverage snapshot (how many docs have embeddings,
// OCR, geo, etc). Cheap index-metadata read; safe to call mid-scan and not
// polled — the admin page fetches it on an explicit button press.
export const getEnrichIndexStats = async () => {
  const res = await fetch(prefix + '/index-stats');
  if (!res.ok) throw new Error('index-stats fetch failed');
  return res.json();
};

// Admin: on-demand OCR quality report — content yield (real text vs empty),
// confidence distribution, version stamps, and the failure list. Heavier than
// the coverage snapshot (it scans every doc's OCR fields), so it's behind its
// own button and not polled. Read-only; safe to call mid-scan.
export const getEnrichOcrStats = async () => {
  const res = await fetch(prefix + '/ocr-stats');
  if (!res.ok) throw new Error('ocr-stats fetch failed');
  return res.json();
};

// Admin: read-only view of the enrichment service's effective (non-secret) env
// configuration, grouped by category. Config is compose-set (not changeable at
// runtime), so this is display-only — there is no write path.
export const getEnrichConfig = async () => {
  const res = await fetch(prefix + '/config');
  if (!res.ok) throw new Error('config fetch failed');
  return res.json();
};

// Admin: trigger a (re)scan/enrichment pass. Non-blocking — returns immediately;
// poll getEnrichStatus() to watch progress. `type` is "full" (default) or "delta".
export const triggerEnrichmentSync = async (type = 'full') => {
  const res = await fetch(prefix + '/enrichment-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  });
  if (!res.ok) throw new Error('enrichment-sync failed');
  return res.json();
};

// Admin: reap orphaned/stale index docs (deleted or edited-away photos).
// Non-blocking — returns immediately; poll getEnrichStatus() (`lastReap`).
export const triggerReap = async () => {
  const res = await fetch(prefix + '/reap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('reap failed');
  return res.json();
};
