## Context

The enrichment service is a single Node process (`enrichment/src/bin/server.js`)
that runs an Express API **and** a BullMQ worker (`startWorker()` at boot). The
worker's per-image pipeline does two synchronous, event-loop-blocking things:

- `embedder.embedImage()` — transformers.js image decode + CLIP ONNX forward,
  measured ~3–4s/image, run on the main thread.
- `reconcile.enqueueAll()` walks the tree via `walkDir` (`fs.readdirSync`) plus a
  per-file `stat` on a delta pass — a synchronous burst over a ~79k-file library.

While either runs, `/health` and the Redis-backed `/status` read are starved. The
visible symptoms were patched downstream: the gallery added a probe timeout +
hysteresis (`routes/enrich.js`) to stop feature-flag flapping, and `getStatus()`
gained an "unknown" branch (Bugfix #4) for when the worker starves its own 1s
Redis read. OCR is **not** part of the problem — it shells out via `execFile`
(child process), so it already yields the loop.

The worker and API today coordinate almost entirely through Redis/BullMQ already;
the *only* reason they share a process is that `startWorker()` sits in the API's
`main()`. The lone in-process coupling is the in-memory `progress.js` counters
(and `reconcile.js` `state`), which the API's `getStatus()`/heartbeat read
directly.

## Goals / Non-Goals

**Goals:**
- The API event loop stays responsive (`/health`, `/status`, `/search`) while
  enrichment is in flight — removing the root cause, not adding another mitigation.
- Make the enrichment/scan workload independently throttleable (its own process,
  concurrency, resource limits, restart).
- Preserve every external contract: the `/status` response shape, the
  non-blocking `started`/`running` trigger semantics, delta/full/reap behavior,
  and the heartbeat — so the gallery proxy and admin page need no change.

**Non-Goals:**
- Offloading the search-time text embed — it stays in the API process (light,
  request-scoped).
- Throughput/scale tuning (lighter CLIP model, GPU, concurrency sizing) — that is
  Enrichment #6, enabled by but separate from this split.
- Reworking the gallery side or the enrichment HTTP/auth surface.
- Making `walkDir` asynchronous — relocating it to the worker process makes its
  synchronous burst harmless (it only delays the worker's own loop, which
  processes jobs sequentially anyway).

## Decisions

### Separate process (B) over an in-process worker_thread pool (A)

Two ways to free the API loop were considered:

- **A — worker_thread pool for the embedder.** Keep one process; offload only
  `embedder.embedImage` to a `worker_threads` pool. Surgical, no deploy change,
  and `progress.js`/`getStatus()` stay in-process untouched.
- **B — separate worker process/container** (chosen). Pull `startWorker()` into a
  new entry point and a second compose service; coordinate via Redis.

B wins for two decisive reasons:

1. **A is an incomplete fix.** It frees the loop only for inference. The
   synchronous reconcile walk (`fs.readdirSync` + per-file `stat`) still runs in
   the API process on every cron tick and manual sync, so `/health` would still
   stall at scan kickoff. Fully fixing that under A means *also* offloading or
   chunking the walk, which erodes A's "one surgical change" appeal.
2. **B's main cost is contained and corrective.** B's headline cost — moving the
   progress counters to Redis — turns out to *improve* the code it touches: once
   the worker leaves the API loop, the event-loop starvation that motivated the
   `getStatus()` "unknown" branch (Bugfix #4) can no longer happen, so that branch
   degrades to a genuine-broker-outage path (more correct). The `/status`
   response shape is preserved, so nothing downstream moves. B also dissolves A's
   thorniest open question (pool-size vs `WORKER_CONCURRENCY`, per-thread model
   weights) — concurrency stays plain process-level BullMQ.

### One image, two processes

Both services build from the same `enrichment/Dockerfile` (CLIP model baked in);
the worker service overrides the container `command`. This avoids a second build
and keeps the model-provisioning path identical.

- **API service** (`bin/server.js`, command unchanged): Express API, `/search`
  (incl. the text embed), `/status`, sync/reap triggers, `/health`,
  `meili.init()`. **Removes** the BullMQ worker, the reconcile cron, the chokidar
  watcher, and the heartbeat.
- **Worker service** (`bin/worker.js`, new): the enrichment Worker
  (`pipeline.runFile`), a control-queue consumer, the reconcile cron, the
  watcher, and the heartbeat. This is the single throttle point.

### Cross-process state in Redis (`scan-state.js`)

A new `enrichment/src/lib/scan-state.js` replaces in-memory `progress.js` and the
`reconcile.js` `state`, reusing the existing ioredis client from
`queue.getConnection()` (no new connection).

- **Progress** (hash `enrichment:progress`): `completed`/`enriched`/`skipped`/
  `active` via `HINCRBY`, `lastCompletedAt` via `HSET`. `reset()` zeroes only the
  session totals, preserving the live `active` gauge + `lastCompletedAt` (same
  semantics as today). On worker boot, set `active=0` to avoid drift across
  restarts.
- **Scan state** (key `enrichment:scan`, JSON): `isEnqueuing`, `isReaping`,
  `nextReconcile`, `lastScan`, `lastReap`. Written by the worker, read by the API.

### Control channel = a BullMQ queue, not bespoke IPC

Triggers arrive at the API (via the gallery proxy) but must execute in the worker.
Rather than invent an IPC path, add a BullMQ `enrichment-control` queue
(concurrency 1, so scans serialize). The API's `triggerReconcile(type)` /
`triggerReap()` check the Redis `isEnqueuing`/`isReaping` flag (return
`{started:false,status:"running"}` if set), else enqueue a control job
`{action}` and return `{started:true,status:"started"}` immediately — preserving
the settled non-blocking contract. The worker consumes the job and runs the
existing `reconcile.enqueueAll(type)` / `reconcile.reap()`. A stable `jobId` is
the dedup safety net.

### Search text-embed stays in the API

`embedText(query)` is one short string per request, not the bulk hammer; keeping
it in the API keeps search self-contained and unaffected by worker load. The
model load is already lazy and search-gated, so a search-idle deployment may never
materialize the API's model copy at all.

## Risks / Trade-offs

- **Progress counters become eventually-consistent** (async fire-and-forget
  `HINCRBY` from the worker's job events, vs today's exact synchronous in-memory
  increments). → A dropped/errored write means minor, cosmetic drift mid-scan;
  `active` resets to 0 on worker boot and the session totals reset at scan start,
  so drift self-heals each cycle. The `enriched`/`skipped` split is approximate
  by a hair, never authoritative (Meili remains the source of truth).
- **Two cron/trigger entry points into one scan** (the worker's own reconcile
  cron, plus control jobs from API-side manual triggers). → Both must go through
  the *same* Redis `isEnqueuing` guard so a scan can't double-run; the guard lives
  in the enqueue/reap entry, not the caller.
- **Two CLIP model copies in memory** (worker for image embed, API for the search
  text embed). → Documented in compose with a memory reservation on the worker.
  Softened by the API's lazy, search-gated load — the second copy is often not
  paid on a search-idle host; don't over-provision for it.
- **`getStatus()` now does two Redis reads** (queue counts + `scan-state`
  snapshot). → Cheap with a free loop, but the `scan-state` read needs a sane
  timeout so a broker blip degrades gracefully like `queueStats()` already does
  (fall back to last-known/`unknown`, never a 5xx).
- **A second long-running container** is a permanent operational cost (more to
  build, run, monitor). → Accepted; it is the price of true isolation and the
  independent throttle point that Enrichment #6 will build on.

## Migration Plan

1. Land the code: `scan-state.js`, `bin/worker.js`, the control queue, the
   `reconcile.js`/`worker.js`/`server.js` edits, `start:worker` script.
2. Add `rpg-enrichment-worker` to `docker-compose.yml` (shared image,
   `command: node src/bin/worker.js`, `/images:ro`, no host port, depends-on
   redis+meili healthy, `restart: unless-stopped`, memory reservation). Move
   `SCAN_INTERVAL_HOURS` off the indexer onto the worker. Mirror into
   `docker-compose.deps.yml` + root `dev:deps`.
3. Deploy: `docker compose build && up`. Both `rpg-enrichment-indexer` and
   `rpg-enrichment-worker` come up healthy; the worker connects to Redis/Meili.
4. Verify the regression is fixed: trigger a Full sync; while the worker enriches,
   `/health` stays prompt and `/status` shows live `progress` sourced from Redis.
   Run a semantic search during the scan to confirm search is unaffected.
5. **Rollback**: revert to the single-process image and remove the worker service
   — the API entry point reverting to `startWorker()` restores the old behavior.
   Redis keys (`enrichment:progress`, `enrichment:scan`, the control queue) are
   transient/self-rebuilding, so no data migration is needed either direction.

## Open Questions

- **Worker memory reservation value** — pick a floor that comfortably holds the
  CLIP model at the deployed `WORKER_CONCURRENCY`, or defer the exact number to
  Enrichment #6 sizing.
- **Control queue retention** — `removeOnComplete`/`removeOnFail` for control jobs
  (they're tiny; default removal is fine, but confirm a failed control job
  surfaces somewhere observable, e.g. the worker's `:error` log).
- **Heartbeat ownership when idle** — the heartbeat moves to the worker and only
  emits while active; confirm no liveness signal is lost for the (now lean) API
  process, or whether the API wants its own minimal heartbeat.
