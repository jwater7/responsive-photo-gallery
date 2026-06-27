# album-build-progress Specification

## Purpose
TBD - created by archiving change frontend-perf-and-prod-readiness. Update Purpose after archive.
## Requirements
### Requirement: Cold-album request returns a building response
When a client requests an album whose cache is missing or stale, the system SHALL
trigger the build (subject to single-flight) and respond with a `202` building status
rather than blocking until the build completes.

#### Scenario: Request to a cold album
- **WHEN** a client requests an album with no ready cache
- **THEN** the system responds `202` indicating a build is in progress

#### Scenario: Request to a warm album
- **WHEN** a client requests an album whose cache is ready and current
- **THEN** the system serves the cached artifacts without a building response

### Requirement: Build status endpoint drives progress
The system SHALL expose an authenticated status endpoint that reports an album's build
state and progress, including processed-vs-total counts and which sprite sheets are
ready, so a client can render a real progress indicator and display sheets as they
become available.

#### Scenario: Polling an in-progress build
- **WHEN** a client polls the status endpoint during a build
- **THEN** it receives the build state, a processed/total count, and the list of sheets ready so far

#### Scenario: Polling a completed build
- **WHEN** a client polls the status endpoint after the build completes
- **THEN** the status reports completion and the manifest lists all sheets

### Requirement: Artifact endpoints serve cover, sheets, and manifest
The system SHALL expose authenticated endpoints to retrieve an album's manifest, its
collage cover, and each sprite sheet, served from the FS cache under the existing
same-origin `/api/v1/*` surface with cache-friendly headers.

#### Scenario: Fetch the manifest
- **WHEN** a client requests an album's manifest for a ready album
- **THEN** the system returns the manifest describing groups, sheets, and cells

#### Scenario: Fetch a sprite sheet
- **WHEN** a client requests a specific ready sprite sheet
- **THEN** the system returns the cached sheet image with cache headers

#### Scenario: Authentication required
- **WHEN** an unauthenticated client requests any build-status or artifact endpoint
- **THEN** the request is rejected by the same auth gate as the rest of `/api/v1/*`

