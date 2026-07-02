// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * MeiliSearch client wrapper. Single shared instance, lazily created and
 * connectivity-checked. Enrichers write partial field updates merged by `hash`
 * (the primary key), so a stage only touches its own fields.
 */

const { Meilisearch } = require("meilisearch");
const config = require("./config");
const geoCells = require("./geo-cells");

const debug = require("debug")("responsive-photo-gallery:meili");
const debugErr = require("debug")("responsive-photo-gallery:meili:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

const INDEX_NAME = "docs";

let client = null;

async function init() {
  if (client) return client;

  const c = new Meilisearch({
    host: config.meiliHostUrl,
    apiKey: config.meiliApiKey,
  });

  // Verify connectivity. On failure leave client null so callers retry lazily.
  await c.health();

  try {
    await c.createIndex(INDEX_NAME, { primaryKey: "hash" });
  } catch (err) {
    if (err.cause?.code !== "index_already_exists") {
      debugErr("createIndex failed: %s", err.message);
    }
  }

  try {
    await c.index(INDEX_NAME).updateSettings({
      filterableAttributes: [
        "_geo", "album", "tags", "place_city", "place_country", "taken_at",
        // Source of a doc's location, so the map can exclude the lower-confidence
        // caption-inferred pins server-side (the `limit` then applies to the
        // non-inferred set, not a viewport's first 500 mixed pins).
        "geo_source",
        // Per-stage failure markers, so the "broken enrichments" list is
        // queryable, e.g. filter `ocr_error IS NOT NULL`. See TODO Enrichment #9.
        "ocr_error", "visual_error", "geo_error", "caption_error",
        // H3 cell ids per resolution (`cell_r<res>`), faceted for the map's
        // server-side density counts. See lib/geo-cells.js.
        ...geoCells.cellFieldNames(),
      ],
      // taken_at = EXIF capture date; last_modified = file mtime, the fallback
      // sort key for photos with no EXIF date (see the /search `sort` handler).
      sortableAttributes: ["taken_at", "last_modified"],
      // Raise the per-facet value cap (default 100) so a viewport's density query
      // returns every populated cell, not a truncated subset.
      faceting: { maxValuesPerFacet: config.geoFacetMaxValues },
    });
  } catch (err) {
    debugErr("update filterable/sortable failed: %s", err.message);
  }

  // Enable vector search (no-op / GA on recent MeiliSearch) and register the
  // userProvided embedder so we can store image vectors and run hybrid search.
  await enableVectorStore();
  try {
    await c.index(INDEX_NAME).updateSettings({
      embedders: {
        [config.embedderName]: {
          source: "userProvided",
          dimensions: config.embedDimensions,
        },
      },
    });
  } catch (err) {
    debugErr("updateEmbedders failed: %s", err.message);
  }

  client = c;
  debug("connected");
  return client;
}

/** Best-effort enable of the vectorStore experimental feature (GA on newer Meili). */
async function enableVectorStore() {
  try {
    await fetch(`${config.meiliHostUrl.replace(/\/$/, "")}/experimental-features`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(config.meiliApiKey ? { Authorization: `Bearer ${config.meiliApiKey}` } : {}),
      },
      body: JSON.stringify({ vectorStore: true }),
    });
  } catch (err) {
    debugErr("enableVectorStore failed (may already be GA): %s", err.message);
  }
}

function index() {
  if (!client) throw new Error("MeiliSearch not initialized");
  return client.index(INDEX_NAME);
}

/** Fetch one document by hash, or null if it doesn't exist. */
async function getDoc(hash) {
  try {
    // retrieveVectors so the pipeline can tell whether a userProvided embedding
    // actually EXISTS, not just whether the `embedded` marker is set. Meili can
    // purge userProvided vectors on an embedder change while leaving that scalar
    // marker behind; without seeing the real vector, a stale marker skips the
    // visual stage forever (the drift that froze the library). The vector payload
    // is small next to the per-file content hash this call precedes.
    return await index().getDocument(hash, { retrieveVectors: true });
  } catch (err) {
    // meilisearch-js v0.50+ moved the API error fields: the Meili error code is
    // now on err.cause.code and the HTTP status on err.response.status (the old
    // err.code / err.httpStatus were removed).
    if (err.cause?.code === "document_not_found" || err.response?.status === 404) return null;
    throw err;
  }
}

/** Partial upsert: merges `fields` into the document keyed by `fields.hash`. */
async function updateFields(fields) {
  await index().updateDocuments([fields]);
}

/**
 * Paginate every document, pulling only `fields`, into a flat array. Shared by
 * the delta scan (stat fields) and the reaping pass (stat fields + the `hash`
 * primary key). Pulling a few fields per doc is far cheaper than reading file
 * contents to hash them.
 */
async function allDocs(fields) {
  await init();
  const out = [];
  const limit = 1000;
  let offset = 0;
  for (;;) {
    const page = await index().getDocuments({ fields, limit, offset });
    const docs = page.results || [];
    out.push(...docs);
    offset += docs.length;
    if (docs.length === 0 || offset >= (page.total ?? 0)) break;
  }
  return out;
}

/**
 * Bulk-fetch the lightweight stat fields of every doc for the delta scan, keyed
 * by `path`. Returns Map<path, Array<{file_size, last_modified}>>. The value is
 * an array because un-reaped orphans (see reconcile/reaping) can share a path
 * across content hashes; delta treats a file as unchanged if *any* of a path's
 * docs matches the on-disk size+mtime.
 */
async function allDocStats() {
  const byPath = new Map();
  for (const d of await allDocs(["path", "file_size", "last_modified"])) {
    if (!d.path) continue;
    let arr = byPath.get(d.path);
    if (!arr) {
      arr = [];
      byPath.set(d.path, arr);
    }
    arr.push({ file_size: d.file_size, last_modified: d.last_modified });
  }
  return byPath;
}

/**
 * Every doc with its `hash` primary key plus the stat fields, for the reaping
 * pass. Returns Array<{hash, path, file_size, last_modified}>.
 */
async function allDocRefs() {
  return allDocs(["hash", "path", "file_size", "last_modified"]);
}

/** Delete docs by their `hash` primary key. No-op for an empty list. */
async function deleteDocs(hashes) {
  if (!hashes || hashes.length === 0) return;
  await index().deleteDocuments(hashes);
}

async function search(query, opts) {
  await init();
  return index().search(query, opts);
}

/**
 * Cheap index-wide coverage snapshot for the admin page. Meili maintains
 * `numberOfDocuments` and a `fieldDistribution` (docs-containing-each-field
 * counts) as index metadata, so this is a single O(1) metadata read — it never
 * scans documents and never touches the enrichment worker/queue. `isIndexing`
 * reflects Meili's own background task processing, not our scan queue.
 */
async function indexStats() {
  await init();
  return index().getStats();
}

/**
 * Index-wide count of FAILED Meili tasks, for admin diagnostics. A nonzero count
 * means document writes are being silently rejected downstream of our pipeline —
 * `updateFields` awaits only the task ENQUEUE, so a task that later fails (e.g. the
 * userProvided-embedder "vectors required" rejection that froze docs at old
 * versions) is invisible to `runFile`. Surfacing it makes that class of silent
 * data loss detectable. Best-effort: returns null if the tasks endpoint can't be
 * read (never throws into /index-stats).
 */
async function failedTaskCount() {
  try {
    const base = config.meiliHostUrl.replace(/\/$/, "");
    const r = await fetch(`${base}/tasks?statuses=failed&limit=1`, {
      headers: config.meiliApiKey ? { Authorization: `Bearer ${config.meiliApiKey}` } : {},
    });
    const d = await r.json();
    return typeof d.total === "number" ? d.total : null;
  } catch (err) {
    debugErr("failedTaskCount failed: %s", err.message);
    return null;
  }
}

function isConnected() {
  return !!client;
}

module.exports = { init, index, getDoc, updateFields, allDocs, allDocStats, allDocRefs, deleteDocs, search, indexStats, failedTaskCount, isConnected, INDEX_NAME };
