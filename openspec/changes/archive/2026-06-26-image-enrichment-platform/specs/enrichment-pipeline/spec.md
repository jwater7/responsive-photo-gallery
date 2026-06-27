# enrichment-pipeline

Supersedes the OCR-era capabilities `ocr-delta-scan`, `ocr-progress-tracking`,
and `ocr-status-api` (to be removed on archive). Delta scanning, progress, and
status now belong to the generalized pipeline; OCR is one enricher.

## ADDED Requirements

### Requirement: Hash-keyed idempotent enrichment
The pipeline SHALL identify each file by the SHA256 of its contents, use that
hash as the document primary key, and run each enricher only when that
enricher's output fields are absent for the hash.

#### Scenario: File missing an enricher's output
- **WHEN** a file's hash has no document, or is missing a given enricher's output fields
- **THEN** that enricher runs and writes its fields, leaving other enrichers' fields untouched

#### Scenario: Re-scan of a fully enriched file
- **WHEN** a file's hash already has every enricher's output fields
- **THEN** no enricher reprocesses the file

### Requirement: Durable queue
The pipeline SHALL enqueue one job per file into Redis via BullMQ, survive
process restarts, retry failed jobs with backoff, and process jobs at a
configurable worker concurrency.

#### Scenario: Restart with queued work
- **WHEN** the service restarts while jobs are waiting or active
- **THEN** pending jobs remain in the queue and are processed after restart

#### Scenario: Transient enricher failure
- **WHEN** a job fails with a transient error
- **THEN** it is retried with backoff up to the configured limit before being marked failed

### Requirement: Event-driven ingestion with reconcile
The pipeline SHALL accept an enqueue event from the gallery on upload, watch the
image tree for out-of-band changes, and run a periodic reconcile scan that skips
hashes already fully enriched.

#### Scenario: Upload event
- **WHEN** the gallery emits an enqueue event for a newly uploaded file
- **THEN** a job is enqueued for that file

#### Scenario: Out-of-band file
- **WHEN** a file appears or changes without an event
- **THEN** the filesystem watcher or the periodic reconcile enqueues it

### Requirement: Pluggable enrichers
The pipeline SHALL run enrichers behind a stable interface (`name`,
`applies(file)`, `enrich(file) -> fields`, `outputFields`) in a defined order,
and a single enricher's failure SHALL NOT abort the others for that file.

#### Scenario: One enricher throws
- **WHEN** an enricher throws while processing a file
- **THEN** the failure is recorded and the remaining enrichers still run for that file

### Requirement: Non-blocking triggers
Any enrichment trigger endpoint SHALL return immediately and SHALL NOT hold the
HTTP request open until enrichment completes.

#### Scenario: Trigger while idle
- **WHEN** `POST /api/v1/ocr-sync` is called and no scan is active
- **THEN** it responds immediately with `{ "status": "started" }` and work proceeds in the background

#### Scenario: Trigger while running
- **WHEN** a scan is already active
- **THEN** it responds immediately with `{ "status": "running" }` and starts no new scan

### Requirement: Non-blocking status
The pipeline SHALL expose `GET /api/v1/status` returning, without blocking,
whether work is in progress, queue depth, active job count, current album/stage,
and the next scheduled reconcile time (null when disabled).

#### Scenario: Query status during a scan
- **WHEN** `GET /api/v1/status` is called while enrichment is running
- **THEN** it returns live progress and queue counts without waiting for the scan to finish

### Requirement: Resilient boot
The enrichment service SHALL start successfully even when Redis or MeiliSearch is
unavailable, retry those dependencies lazily, and never crash the process over a
missing dependency.

#### Scenario: Dependencies down at startup
- **WHEN** Redis or MeiliSearch is unreachable at boot
- **THEN** the service still starts, serves `/status`, and retries the dependency lazily
