## ADDED Requirements

### Requirement: Dedicated enrichment worker service

The production stack SHALL run the enrichment worker as a separate long-running
service from the enrichment API/indexer, built from the same image with an
overridden command. The worker service SHALL have no host-published ports, SHALL
mount the image tree read-only, SHALL have a restart policy, and SHALL start only
after Redis and MeiliSearch report healthy. The reconcile cron schedule
(`SCAN_INTERVAL_HOURS`) SHALL be configured on the worker service, not the
API/indexer service.

#### Scenario: Worker service brought up alongside the API

- **WHEN** the production stack is brought up
- **THEN** a separate enrichment worker service runs from the shared image with no
  host ports, mounts the images read-only, and is restarted automatically if it
  exits

#### Scenario: Worker waits for its datastores

- **WHEN** the stack starts and Redis or MeiliSearch is not yet healthy
- **THEN** the enrichment worker service waits for them to report healthy before
  starting

#### Scenario: Cron runs in the worker

- **WHEN** the recurring reconcile schedule is configured
- **THEN** the cron fires inside the worker service (which owns the scan walk and
  enrichment), not the API/indexer service

### Requirement: Worker memory sized to the model

The enrichment worker service SHALL declare a memory reservation/limit sized to
hold the CLIP model at the configured worker concurrency, so the model load
cannot exhaust host resources.

#### Scenario: Worker memory bounded

- **WHEN** the worker service loads the CLIP model and processes images at its
  configured concurrency
- **THEN** its memory usage is bounded by the configured reservation/limit
