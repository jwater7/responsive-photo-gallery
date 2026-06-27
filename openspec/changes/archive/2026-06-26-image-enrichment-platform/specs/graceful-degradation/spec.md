# graceful-degradation

The main gallery must remain fully functional when the entire enrichment plane
(MeiliSearch, Redis, the enrichment service, the local models) is down.
Enrichment and search/map are strictly additive and optional.

## ADDED Requirements

### Requirement: Gallery independence
The gallery's browse, authenticate, view, thumbnail, and upload paths SHALL
succeed with Redis, MeiliSearch, and the enrichment service all stopped, and
SHALL NOT import from or make a blocking call into the enrichment/search plane on
any such path.

#### Scenario: Enrichment plane fully down
- **WHEN** Redis, MeiliSearch, and the enrichment service are all stopped
- **THEN** browsing, login, viewing, thumbnails, and uploads all still work

#### Scenario: Hot-path coupling guard
- **WHEN** the codebase is linted/tested
- **THEN** a guard fails if a gallery hot-path module imports or synchronously calls the enrichment/search plane

### Requirement: Best-effort enqueue
Upload-time enrichment enqueue SHALL be best-effort: if the queue is unreachable,
the upload still succeeds and the file is enriched later by reconcile.

#### Scenario: Upload during a queue outage
- **WHEN** a user uploads while Redis is down
- **THEN** the upload succeeds and the file is picked up by a later reconcile scan

### Requirement: Fail-soft search and map UI
The frontend search box and map SHALL be optional surfaces that degrade (hidden
or an "unavailable" state) when MeiliSearch is unreachable, without blocking or
erroring the rest of the UI.

#### Scenario: Search backend unreachable
- **WHEN** the frontend cannot reach MeiliSearch
- **THEN** the search box and map show an unavailable state and browsing is unaffected

### Requirement: Non-blocking triggers are final
Every enrichment/scan trigger SHALL return immediately (`started`/`running`) and
SHALL NOT hold an HTTP request open until enrichment completes; progress and
stats are observed via `/status`. This decision is settled and SHALL NOT be
re-litigated.

#### Scenario: Long scan triggered
- **WHEN** a scan that will take a long time is triggered
- **THEN** the endpoint responds immediately and the client observes progress via `/status`
