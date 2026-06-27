// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

const express = require("express");

const meili = require("../lib/meili");
const ocrStats = require("../lib/ocr-stats");
const scanState = require("../lib/scan-state");
const configView = require("../lib/config-view");
const reconcile = require("../lib/reconcile");
const queue = require("../lib/queue");
const config = require("../lib/config");
const embedder = require("../lib/embedder");
const geonames = require("../lib/geonames");
const path = require("path");
const { SUPPORTED_FORMAT_REGEXP } = require("../lib/walk-dir");

const debugErr = require("debug")("responsive-photo-gallery:enrichment-api:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

const router = express.Router();

/**
 * @swagger
 * /search:
 *   post:
 *     summary: Search images by indexed content
 *     produces: application/json
 *     parameters:
 *       - name: body
 *         in: body
 *         required: true
 *         schema:
 *           type: object
 *           properties:
 *             query: { type: string, example: "cat dog house" }
 *             offset: { type: integer }
 *             limit: { type: integer }
 *             sort: { type: string, enum: ["date:desc", "date:asc"], description: "Order by capture date (EXIF, mtime fallback); omit for relevance order" }
 *     responses:
 *       200: { description: Search results }
 *       400: { description: Missing query }
 *       503: { description: MeiliSearch unavailable }
 */
router.post("/search", async (req, res) => {
  const body = req.body || {};
  const { offset = 0, limit = 20 } = body;
  const query = typeof body.query === "string" ? body.query : "";

  const semanticRatio =
    body.semanticRatio !== undefined
      ? Number(body.semanticRatio)
      : config.defaultSemanticRatio;

  const opts = { limit: Number(limit), offset: Number(offset) };

  // Optional filters: caller-supplied filter expression(s), a map-viewport geo
  // bounding box ([[topRightLat, topRightLng], [bottomLeftLat, bottomLeftLng]]
  // per MeiliSearch), and a taken_at range.
  const filters = [];
  if (body.filter) {
    filters.push(...(Array.isArray(body.filter) ? body.filter : [body.filter]));
  }
  const bbox = body.geoBoundingBox;
  if (Array.isArray(bbox) && bbox.length === 2) {
    filters.push(`_geoBoundingBox([${bbox[0][0]}, ${bbox[0][1]}], [${bbox[1][0]}, ${bbox[1][1]}])`);
  }
  if (body.takenAfter) filters.push(`taken_at >= "${body.takenAfter}"`);
  if (body.takenBefore) filters.push(`taken_at <= "${body.takenBefore}"`);
  if (filters.length) opts.filter = filters;

  // Optional relevance cutoff (0..1). Semantic/hybrid ranks every document, so
  // without a threshold a query returns the whole collection re-ordered. A
  // threshold drops weak matches, making "smart" search behave like a filter.
  if (body.rankingScoreThreshold !== undefined) {
    const t = Number(body.rankingScoreThreshold);
    if (Number.isFinite(t)) opts.rankingScoreThreshold = t;
  }
  if (body.showRankingScore) opts.showRankingScore = true;

  // Optional result ordering. Only an explicit, whitelisted date sort is
  // honored; the default (and anything unrecognized) leaves results in
  // relevance order (keyword ranking, or the hybrid score for a smart search).
  // Meili applies `sort` AFTER ranking, so a semantic search sorted by date
  // keeps its rankingScoreThreshold filtering but drops the relevance ordering
  // within the surviving set — intended. Each value maps to a two-key sort:
  // `taken_at` (EXIF capture date) first, then `last_modified` (file mtime) so
  // photos with no EXIF date fall back to mtime and land after the dated ones.
  const SORT_OPTIONS = {
    "date:desc": ["taken_at:desc", "last_modified:desc"],
    "date:asc": ["taken_at:asc", "last_modified:asc"],
  };
  if (body.sort && SORT_OPTIONS[body.sort]) {
    opts.sort = SORT_OPTIONS[body.sort];
  }

  // Need either a text query or at least one filter (e.g. a map viewport).
  if (!query && !filters.length) {
    return res.status(400).json({
      error: { code: 400, message: "A query string or a filter is required" },
    });
  }

  // Hybrid: embed the query locally and blend semantic similarity with keyword.
  // Only meaningful with a text query; falls back to keyword/filter-only if the
  // model is unavailable.
  if (query && semanticRatio > 0) {
    try {
      opts.vector = await embedder.embedText(query);
      opts.hybrid = { semanticRatio, embedder: config.embedderName };
    } catch (err) {
      debugErr("query embedding failed, keyword-only: %s", err.message);
    }
  }

  try {
    const results = await meili.search(query, opts);
    return res.status(200).json({
      query,
      offset: Number(offset),
      limit: Number(limit),
      semanticRatio: opts.hybrid ? semanticRatio : 0,
      total: results.estimatedTotalHits ?? results.hits.length,
      results: results.hits,
    });
  } catch (err) {
    debugErr("search failed: %s", err.message);
    return res.status(503).json({
      error: { code: 503, message: "OCR index not available - unable to reach MeiliSearch" },
    });
  }
});

/**
 * @swagger
 * /enrichment-sync:
 *   post:
 *     summary: Trigger a reconcile scan (full re-hash, or stat-gated delta)
 *     description: >-
 *       Non-blocking. Walks the image tree and enqueues files; enrichment runs in
 *       background workers. type "full" enqueues every file (the worker hashes
 *       each, re-reading the library off disk) — the thorough integrity pass.
 *       type "delta" pre-filters by a cheap stat (size+mtime) against the index
 *       and enqueues only new/changed files — the cheap recurring pass (the daily
 *       cron uses this). Poll GET /status for progress. Returns "running" if a
 *       reconcile enqueue is already underway.
 *     produces: application/json
 *     responses:
 *       200: { description: Reconcile started or already running }
 *       400: { description: Invalid type }
 */
router.post("/enrichment-sync", async (req, res) => {
  const type = (req.body && req.body.type) || "full";
  if (!["full", "delta"].includes(type)) {
    return res.status(400).json({
      error: { code: 400, message: 'Invalid type. Use "full" or "delta"' },
    });
  }

  const { started, status } = await reconcile.triggerReconcile(type);
  return res.status(200).json({
    status,
    type,
    message: started
      ? `${type === "delta" ? "Delta" : "Full"} scan started`
      : "Reconcile already in progress",
  });
});

/**
 * @swagger
 * /reap:
 *   post:
 *     summary: Reap orphaned/stale index docs (deleted or edited-away files)
 *     description: >-
 *       Non-blocking. Deletes Meili docs that no longer match a file on disk:
 *       docs whose `path` is gone (a deleted file), and superseded content-hash
 *       duplicates left behind when a file at a still-present path was edited.
 *       Refuses to run if the image tree reads as empty (a likely mount glitch),
 *       so a transient unmount can't wipe the index. Scoped to the index only;
 *       the gallery's sprite/thumb cache self-heals on its own. Poll GET /status
 *       (`lastReap`) for the result. Returns "running" if a reap is already
 *       underway.
 *     produces: application/json
 *     responses:
 *       200: { description: Reap started or already running }
 */
router.post("/reap", async (req, res) => {
  const { started, status } = await reconcile.triggerReap();
  return res.status(200).json({
    status,
    message: started ? "Reap started" : "Reap already in progress",
  });
});

/**
 * @swagger
 * /enqueue:
 *   post:
 *     summary: Enqueue a single file for enrichment (upload hook)
 *     description: >-
 *       Best-effort hook the gallery can call on upload. Non-blocking; if the
 *       queue is down it fails soft and the file is picked up by the next
 *       reconcile.
 *     produces: application/json
 *     parameters:
 *       - name: body
 *         in: body
 *         required: true
 *         schema:
 *           type: object
 *           properties:
 *             path: { type: string, description: "path relative to IMAGE_PATH", example: "holidays/beach.jpg" }
 *     responses:
 *       200: { description: Enqueued (or accepted best-effort) }
 *       400: { description: Missing or unsupported path }
 */
router.post("/enqueue", async (req, res) => {
  const rel = req.body && req.body.path;
  if (!rel || typeof rel !== "string" || rel.includes("..")) {
    return res.status(400).json({ error: { code: 400, message: "Valid relative path required" } });
  }
  if (!SUPPORTED_FORMAT_REGEXP.test(rel)) {
    return res.status(400).json({ error: { code: 400, message: "Unsupported file type" } });
  }

  const relPath = rel.split(path.sep).join("/");
  const album = relPath.includes("/") ? relPath.split("/")[0] : "root";
  const file = { album, relPath, absPath: path.join(config.imagePath, relPath) };

  try {
    await queue.enqueueFile(file);
    return res.status(200).json({ status: "enqueued", path: relPath });
  } catch (err) {
    // Best-effort: reconcile will catch it later.
    debugErr("enqueue failed: %s", err.message);
    return res.status(200).json({ status: "deferred", path: relPath });
  }
});

/**
 * @swagger
 * /geo:
 *   post:
 *     summary: Manually assign a location to an indexed image
 *     description: >-
 *       Sets `_geo` + `geo_source: "manual"` for a document (by `hash`). Manual
 *       locations take precedence and are never overwritten by EXIF on re-scan.
 *     produces: application/json
 *     parameters:
 *       - name: body
 *         in: body
 *         required: true
 *         schema:
 *           type: object
 *           properties:
 *             hash: { type: string }
 *             lat: { type: number }
 *             lng: { type: number }
 *     responses:
 *       200: { description: Location saved }
 *       400: { description: Missing hash/lat/lng }
 *       503: { description: MeiliSearch unavailable }
 */
router.post("/geo", async (req, res) => {
  const { hash, lat, lng } = req.body || {};
  if (!hash || typeof hash !== "string" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({
      error: { code: 400, message: "hash, lat and lng are required" },
    });
  }

  const fields = {
    hash,
    _geo: { lat, lng },
    geo_source: "manual",
    geo_checked: true,
  };
  const place = geonames.reverse(lat, lng);
  if (place) {
    fields.place = [place.city, place.region, place.country].filter(Boolean).join(", ");
    fields.place_city = place.city;
    fields.place_country = place.country;
  }

  try {
    await meili.init();
    // Only an already-indexed image can be pinned. A partial update preserves
    // its existing _vectors; writing a brand-new doc would fail the embedder's
    // "vectors required" validation.
    const existing = await meili.getDoc(hash);
    if (!existing) {
      return res.status(404).json({
        error: { code: 404, message: "Image not indexed; cannot assign a location" },
      });
    }
    await meili.updateFields(fields);
    return res.status(200).json({ status: "ok", _geo: fields._geo, place: fields.place || null });
  } catch (err) {
    debugErr("manual geo failed: %s", err.message);
    return res.status(503).json({ error: { code: 503, message: "MeiliSearch unavailable" } });
  }
});

/**
 * @swagger
 * /status:
 *   get:
 *     summary: Current enrichment status (non-blocking)
 *     produces: application/json
 *     responses:
 *       200: { description: Queue depth, active jobs, next reconcile }
 */
router.get("/status", async (req, res) => {
  return res.status(200).json(await reconcile.getStatus());
});

/**
 * @swagger
 * /index-stats:
 *   get:
 *     summary: Enrichment coverage snapshot (one-shot, non-blocking)
 *     description: >-
 *       How many indexed documents carry each enrichment, derived from Meili's
 *       `fieldDistribution` index metadata (docs-containing-each-field counts).
 *       A single O(1) metadata read — it scans no documents and never touches
 *       the enrichment worker/queue, so the admin "Fetch" button is safe to hit
 *       mid-scan. Counts reflect a field's presence: `ocrProcessed` means the
 *       OCR stage ran (text may be empty); `withLocation` is docs that got a
 *       coordinate (EXIF or manual).
 *     produces: application/json
 *     responses:
 *       200: { description: Coverage counts }
 *       503: { description: MeiliSearch unavailable }
 */
router.get("/index-stats", async (req, res) => {
  try {
    const stats = await meili.indexStats();
    const fd = stats.fieldDistribution || {};
    return res.status(200).json({
      totalDocs: stats.numberOfDocuments || 0,
      indexing: !!stats.isIndexing,
      coverage: {
        // visual.js writes `embedded: true` alongside the stored _vectors.
        embeddings: fd.embedded || 0,
        // ocr.js always writes `confidence` when the stage runs (text may be "").
        ocrProcessed: fd.confidence || 0,
        // geo.js writes `geo_checked: true` whether or not GPS was found...
        geoChecked: fd.geo_checked || 0,
        // ...and `geo_source` only when a coordinate was actually assigned.
        withLocation: fd.geo_source || 0,
        withPlaceName: fd.place_city || 0,
        withCaptureDate: fd.taken_at || 0,
        withTags: fd.tags || 0,
        // caption.js writes `caption` only when an embedded IPTC/XMP/IFD0
        // description was found (the `caption_checked` marker is the "examined").
        withCaption: fd.caption || 0,
      },
    });
  } catch (err) {
    debugErr("index-stats failed: %s", err.message);
    return res.status(503).json({
      error: { code: 503, message: "MeiliSearch unavailable" },
    });
  }
});

/**
 * @swagger
 * /ocr-stats:
 *   get:
 *     summary: OCR quality report (on-demand, scans the index)
 *     description: >-
 *       Per-document OCR quality across the index: content yield (docs with
 *       real text vs empty), confidence distribution (stored 0-1 mean kept-word
 *       confidence), version stamps, and the failure list. Unlike /index-stats
 *       (an O(1) field-metadata read), this paginates every doc pulling its OCR
 *       fields, so it's heavier — fetched on demand, not polled. Read-only, so
 *       it's safe to run mid-scan.
 *     produces: application/json
 *     responses:
 *       200: { description: OCR quality summary }
 *       503: { description: MeiliSearch unavailable }
 */
router.get("/ocr-stats", async (req, res) => {
  try {
    return res.status(200).json(await ocrStats.compute());
  } catch (err) {
    debugErr("ocr-stats failed: %s", err.message);
    return res.status(503).json({
      error: { code: 503, message: "MeiliSearch unavailable" },
    });
  }
});

/**
 * @swagger
 * /config:
 *   get:
 *     summary: Effective enrichment configuration (read-only)
 *     description: >-
 *       The non-secret, effective runtime config — each setting's env var, value,
 *       default, and whether it's an env override or the default. Read-only
 *       (config is compose-set, not changeable at runtime). Two distinct objects,
 *       each reported by the process that OWNS its settings so neither guesses
 *       the other: `worker` (OCR/tag/scan/watcher), read from the worker's
 *       Redis-published config — null until the worker has reported; and
 *       `service` (search blend, infra connections), reported by this API
 *       process directly. Secrets (MEILI_MASTER_KEY) are omitted; URLs are
 *       host-only.
 *     produces: application/json
 *     responses:
 *       200: { description: "{ worker, service } config objects" }
 */
router.get("/config", async (req, res) => {
  const worker = await scanState.getConfig(); // { at, source:"worker", categories } | null
  const service = { source: "api", categories: configView.serviceConfig() };
  return res.status(200).json({ worker: worker || null, service });
});

module.exports = router;
