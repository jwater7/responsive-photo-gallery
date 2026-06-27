## 1. Redis-backed shared state

- [x] 1.1 Add `enrichment/src/lib/scan-state.js`: Redis-backed progress hash
  (`enrichment:progress` — `completed`/`enriched`/`skipped`/`active` via
  `HINCRBY`, `lastCompletedAt` via `HSET`) and scan-state key (`enrichment:scan`
  JSON — `isEnqueuing`/`isReaping`/`nextReconcile`/`lastScan`/`lastReap`), reusing
  `queue.getConnection()` (no new connection).
- [x] 1.2 Implement `reset()` (zero session totals only; preserve `active` +
  `lastCompletedAt`), `recordStarted/recordCompleted/recordFailed` (async,
  fire-and-forget with error catch; keep the `res.ran.length>0 ? enriched :
  skipped` split), `snapshot()` (`HGETALL` + int parse, with a sane read timeout
  so a broker blip degrades gracefully), and a `bootReset()` that sets `active=0`.
- [x] 1.3 Remove `enrichment/src/lib/progress.js` (logic migrated to scan-state).

## 2. Control channel

- [x] 2.1 Add the `enrichment-control` queue + an `enqueueControl({action})`
  helper to `enrichment/src/lib/queue.js` (stable `jobId` for dedup); leave
  `queueStats()` unchanged.
- [x] 2.2 In `enrichment/src/lib/worker.js`, add `startControlWorker()`
  (concurrency 1) that consumes control jobs and runs
  `reconcile.enqueueAll(type)` / `reconcile.reap()`, setting/clearing the Redis
  `isEnqueuing`/`isReaping` flag and writing `lastScan`/`lastReap`.

## 3. Reconcile + worker wiring to Redis state

- [x] 3.1 Update `enrichment/src/lib/reconcile.js`: `enqueueAll`/`reap` read/write
  Redis scan-state via `scan-state.js` (replace the in-memory `state`);
  `progress.reset()` → `scanState.reset()`; `getStatus()` reads `scanState` +
  `queueStats()` and returns the **same response shape** as today.
- [x] 3.2 Convert `triggerReconcile(type)` / `triggerReap()` to: check the Redis
  in-progress flag (return `{started:false,status:"running"}` if set) else
  `enqueueControl({action})` and return `{started:true,status:"started"}`.
- [x] 3.3 Ensure the worker's reconcile cron path goes through the **same**
  in-progress guard as the control-job path so a scan can never double-run.
- [x] 3.4 Update `enrichment/src/lib/worker.js` job-event handlers to call the
  async scan-state recorders; call `bootReset()` (`active=0`) on worker start.

## 4. Process split (entry points)

- [x] 4.1 Add `enrichment/src/bin/worker.js`: best-effort `meili.init()`,
  `startWorker()`, `startControlWorker()`, the chokidar watcher (moved from
  `server.js`), the reconcile cron (moved from `server.js`; writes
  `nextReconcile` to Redis), the enrichment heartbeat (moved from `server.js`),
  and graceful shutdown (`stopWorker`, control worker close, enrichers
  `terminate()`, `queue.close()`).
- [x] 4.2 Strip from `enrichment/src/bin/server.js`: `startWorker()`, the
  reconcile cron, the chokidar watcher, the heartbeat, and the `enrichers`
  import/terminate; keep Express, swagger, `/api/v1`, `/health`, `meili.init()`,
  and `queue.close()` on shutdown. Confirm `embedText(query)` for `/search` still
  works in this process.
- [x] 4.3 Add `"start:worker": "node src/bin/worker.js"` to
  `enrichment/package.json`.

## 5. Deployment

- [x] 5.1 Add the `rpg-enrichment-worker` service to `docker-compose.yml`: shared
  `build: ./enrichment`, `command: ["node","src/bin/worker.js"]`, `/images:ro`,
  env (`IMAGE_PATH`/`MEILI_HOST_URL`/`REDIS_URL`/`WORKER_CONCURRENCY`/
  `MODEL_CACHE_PATH`/`SCAN_INTERVAL_HOURS`/`HEARTBEAT_INTERVAL_MIN`),
  `depends_on` redis+meili healthy, `restart: unless-stopped`, no host port, and a
  memory reservation/limit sized to the CLIP model. Move `SCAN_INTERVAL_HOURS`
  off `rpg-enrichment-indexer` onto the worker.
- [x] 5.2 Bring the worker up for native dev: update `docker-compose.deps.yml` and
  the root `package.json` `dev:deps` script.

## 6. Verification

- [x] 6.1 `cd enrichment && npm run eslint` — clean.
- [x] 6.2 Root `npm test` — stays 27/27 (gallery unaffected).
- [x] 6.2a (extra) Functional smoke test of the new plumbing against a real Redis:
  scan-state progress counters (completed/enriched/skipped/active), reset
  semantics (preserves the live gauge), scan flags + lastScan round-trip, the
  trigger guard (running when flagged), jobId dedup (scan→1 job; scan+reap→2), and
  `getStatus()` returning the unchanged 9-key shape with `queueStatus:"ok"`. Also
  validated `docker compose config` parses. (Code paths exercised end to end; the
  CLIP/Meili-dependent integration steps below still need the full stack.)
- [x] 6.3 `docker compose build && up` — both `rpg-enrichment-indexer` and
  `rpg-enrichment-worker` come up healthy; the worker connects to Redis/Meili.
  (Verified: indexer healthy, worker logs "meili connected" + "worker started |
  redis ... | concurrency 2" + cron scheduled.)
- [x] 6.4 Trigger a Full sync; while the worker is enriching, confirm `/health`
  returns `{status:"ok"}` promptly/consistently and `/status` shows live
  `progress` + correct `queue` sourced from Redis (`inProgress:true`). (Verified
  on an un-enriched library: `/health` 200 in ~0.0004s ×5 while `queue.active:2`,
  `waiting:2441`; `/status` showed live Redis-sourced progress climbing
  enriched 286→1322, `queueStatus:"ok"`.)
- [x] 6.5 Run a semantic search during the scan — search text-embed still works in
  the API process and latency is unaffected. (Verified: `POST /search`
  "beach sunset" → 200 in 0.40s, 284 hits, hybrid semanticRatio 0.5, while the
  worker was pegged on CLIP.)
- [x] 6.6 Restart only the worker container mid-scan — API stays up; `active`
  gauge resets cleanly; queued jobs resume. (Verified: `/health` 200 in 0.00035s
  immediately after the worker restart; `progress.active` reset to 0 via
  bootReset; `queue.active` back to 2, `waiting` and `completed` kept advancing.)
- [x] 6.7 Check `docker logs rpg-enrichment-worker` — enricher debug lines +
  heartbeat appear (via node `debug`). (Verified: per-file `:worker .../NNN.jpg:
  ran ocr, visual, geo` lines, and a `:heartbeat reconcile active: ... active=2
  waiting=1182 | processed=1322 (enriched=1322 skipped=0)` line via a temporary
  1-min interval.)
