## Why

The enrichment service runs its BullMQ worker in the **same Node process** as the
Express API, so the heavy per-image work — the synchronous CLIP forward in
`embedder.embedImage()` (~3–4s/image) and the synchronous reconcile walk
(`walkDir` → `fs.readdirSync` over the whole library) — blocks the shared event
loop. That starves `/health` and the Redis-backed `/status` read, which is the
root cause behind the gallery's feature-flag flapping and Bugfix #4's "idle while
indexing" misreport. Both were only mitigated downstream (probe timeout +
hysteresis in the gallery, an "unknown" branch in status); this removes the cause.

## What Changes

- Run the long-lived scanning/enrichment work as a **separate process/container**
  (same image, overridden `command`), so heavy inference never shares the API's
  event loop. The API process keeps Express, `/search`, `/status`, the
  sync/reap triggers, and `/health`.
- Move the cross-process coordination to **Redis**: progress counters and
  scan/reap state migrate out of the in-memory `progress.js` / `reconcile.js`
  `state` into a Redis-backed store the worker writes and the API reads.
- Add a **control channel** (a BullMQ `enrichment-control` queue, concurrency 1)
  so the API turns proxied `enrichment-sync` / `reap` triggers into jobs the
  worker executes — preserving the settled non-blocking `started`/`running`
  contract.
- Relocate the **reconcile cron, the chokidar watcher, and the enrichment
  heartbeat** from the API process into the worker process.
- Keep the **search-time text embed** (`embedText(query)`) in the API process —
  it is a single short string per request, not the bulk hammer, so search
  servicing stays self-contained and unaffected by worker load.
- The gallery side, the `/status` response shape, the admin page, and the
  delta/full/reap semantics are **unchanged** — only where the numbers are
  sourced moves.

## Capabilities

### New Capabilities
- `enrichment-worker-process`: the enrichment worker runs as a separate process
  from the API; the API event loop stays responsive (`/health`, `/status`,
  `/search`) while enrichment is in flight; triggers, progress, and scan state are
  coordinated through Redis rather than in-process memory.

### Modified Capabilities
- `production-deployment`: the production stack gains a second long-running
  enrichment **worker** service (own restart policy, resource limits, and
  health-ordered startup) alongside the API/indexer service.

## Impact

- **Enrichment service** (`enrichment/`):
  - New `src/bin/worker.js` entry point (worker, control consumer, cron, watcher,
    heartbeat).
  - New `src/lib/scan-state.js` (Redis-backed progress + scan/reap state),
    replacing in-memory `src/lib/progress.js`.
  - `src/lib/queue.js` gains the `enrichment-control` queue + enqueue helper.
  - `src/lib/reconcile.js` reads/writes Redis scan-state; triggers become guarded
    control-job enqueues; `getStatus()` keeps the same response shape.
  - `src/lib/worker.js` records progress via the async Redis recorders and exports
    the control worker.
  - `src/bin/server.js` strips the worker, cron, watcher, and heartbeat.
  - `package.json` gains a `start:worker` script.
- **Deployment**: `docker-compose.yml` adds the `rpg-enrichment-worker` service
  (shared image, `/images:ro`, no host port, depends-on redis+meili healthy);
  `docker-compose.deps.yml` + root `dev:deps` bring it up for native dev. The
  reconcile cron env (`SCAN_INTERVAL_HOURS`) moves to the worker.
- **Gallery**: no code change. `routes/enrich.js`, the admin page, and `use-ping`
  consume the same endpoint shapes.
- **Behavior change**: progress counters become eventually-consistent (async
  fire-and-forget Redis writes) instead of exact in-memory increments, and now
  survive an API restart.
