## ADDED Requirements

### Requirement: Enrichment worker runs outside the API process

The enrichment worker SHALL run in a separate OS process from the Express API, so the heavy per-image work (CLIP inference and the reconcile tree walk) never runs on the API event loop. The API process SHALL NOT execute the BullMQ enrichment worker, the reconcile cron, the filesystem watcher, or the enrichment heartbeat. The two processes SHALL build from the same image and coordinate only through Redis (the queue, the control channel, and the shared scan state).

#### Scenario: API loop stays responsive during enrichment

- **WHEN** the worker process is actively enriching images (CLIP inference in
  flight) and a client requests `GET /health` on the API process
- **THEN** the API responds promptly and consistently (not blocked behind a
  per-image inference window), because no inference runs on the API event loop

#### Scenario: API serves search and status while the worker is busy

- **WHEN** a scan is in progress in the worker process
- **THEN** the API process still serves `POST /search` and `GET /status` with
  latency unaffected by worker load

#### Scenario: Worker absent does not break the API

- **WHEN** the worker process is stopped or has crashed
- **THEN** the API process continues to serve `/health`, `/search`, and
  `/status`, and a `/status` request reports the queue/scan state from Redis
  without erroring

### Requirement: Triggers flow through a Redis control channel

Scan and reap triggers SHALL be accepted by the API process and executed in the
worker process via a Redis-backed control channel, preserving the non-blocking
`started`/`running` contract. The API SHALL NOT execute the enqueue or reap walk
itself.

#### Scenario: Trigger accepted and acknowledged immediately

- **WHEN** the gallery proxy posts a sync (`full`/`delta`) or reap trigger to the
  API while no scan/reap is currently running
- **THEN** the API records the in-progress flag in Redis, enqueues a control job
  for the worker, and returns `{ started: true, status: "started" }` immediately
  without waiting for the walk to complete

#### Scenario: Concurrent trigger is rejected, not duplicated

- **WHEN** a sync or reap trigger arrives while one is already in progress
- **THEN** the API returns `{ started: false, status: "running" }` and no second
  scan/reap is started

#### Scenario: Scans serialize across both entry points

- **WHEN** the worker's reconcile cron fires while a manually-triggered scan is
  in progress (or vice versa)
- **THEN** the shared in-progress guard prevents a second concurrent scan, so a
  scan never double-runs

### Requirement: Progress and scan state are shared through Redis

Per-session progress counters and scan/reap state SHALL be stored in Redis,
written by the worker and read by the API's `GET /status` and heartbeat. The
`GET /status` response SHALL keep the same shape as before the split so the
gallery proxy and admin page need no change. Progress counters MAY be
eventually-consistent (the worker writes them fire-and-forget so job throughput is
never throttled).

#### Scenario: Status reflects worker progress across the process boundary

- **WHEN** the worker has processed part of a scan session and a client requests
  `GET /status` from the API
- **THEN** the response reports the live progress (`completed`/`enriched`/
  `skipped`/`active`), `inProgress`, queue counts, and `lastScan`/`lastReap`
  sourced from Redis, in the same response shape as before the split

#### Scenario: Session totals reset at scan start, live gauges preserved

- **WHEN** a new scan session starts
- **THEN** the session totals (`completed`/`enriched`/`skipped`) reset to zero
  while the live `active` gauge and `lastCompletedAt` are preserved

#### Scenario: Active gauge does not drift across worker restarts

- **WHEN** the worker process restarts
- **THEN** the `active` gauge is reset to zero on boot so a crash mid-job cannot
  leave a stale in-flight count

#### Scenario: Status degrades gracefully when Redis is unreadable

- **WHEN** a `GET /status` request cannot read the shared scan state or queue
  counts (broker blip)
- **THEN** the API returns a best-effort status (last-known or an explicit
  unknown), not an HTTP 5xx
