# dev-runtime-modes Specification

## Purpose
TBD - created by archiving change harden-enrichment-routing-dev-modes. Update Purpose after archive.
## Requirements
### Requirement: Single set of data paths across run modes
The native (`npm run debug`) and docker-compose run modes SHALL read and write
gallery state (auth, thumbs, tags, mongo) to the same host paths. The nested
`debug-data/data/` duplicate SHALL be removed.

#### Scenario: State is shared between modes
- **WHEN** the app is run natively and then under docker-compose (or vice versa)
- **THEN** both modes use the same auth/thumbs/tags/mongo directories and observe each other's state

#### Scenario: No duplicate path tree
- **WHEN** the repository data layout is inspected
- **THEN** there is no `debug-data/data/` nested copy of auth/thumbs/tags shadowing the top-level paths

### Requirement: Backends-only compose surface for native dev
There SHALL be a way to bring up only the stateful backends (Redis, MeiliSearch,
Mongo, the enrichment service) with ports published to localhost, without
starting the gallery app container.

#### Scenario: Start deps only
- **WHEN** the deps compose surface (override file or profile) is brought up
- **THEN** Redis, MeiliSearch, Mongo, and the enrichment service start with localhost-published ports and the gallery app container is not started

### Requirement: Backend reached only through a single wildcard
Next SHALL reach the backend only through a single wildcard `/api/*` to the
Express API (the dev `rewrites` proxy), and SHALL NOT define Next API routes or
talk to the enrichment service directly. Enrichment SHALL be reachable only as
part of that one API surface (`/api/v1/enrich`).

#### Scenario: Single channel in dev
- **WHEN** `frontend/next.config.js` is inspected
- **THEN** the only backend route is the single `/api/:path*` rewrite to the Express API, and there are no Next API routes

#### Scenario: Enrichment rides the same channel
- **WHEN** the frontend calls an enrichment endpoint in dev
- **THEN** the request goes through the `/api/*` rewrite to the Express API's `/api/v1/enrich`, not to the enrichment service directly

### Requirement: Native hot-reload dev loop
There SHALL be documented `package.json` scripts to run Express and the Next dev
server natively with reload, with the dockerized enrichment service reachable via
`ENRICH_URL`. The browser SHALL stay same-origin to the Next dev server, which
forwards `/api/*` to the native Express, so authentication works without CORS.

#### Scenario: Edit-reload cycle
- **WHEN** a developer runs the native dev scripts against the deps backends and edits a gallery UI or API file
- **THEN** the change is picked up without rebuilding a container, and API calls reach the Express API (and through it the dockerized backends)

#### Scenario: Native dev auth posture
- **WHEN** running the native dev loop
- **THEN** the gallery runs with authentication ON (same-origin via the rewrite makes the JWT cookie work); `NO_AUTHENTICATION=yes` is available only as an opt-in escape hatch

#### Scenario: Compose mode exercises real auth
- **WHEN** the prod-like docker-compose mode runs
- **THEN** the frontend is served same-origin by Express with authentication enabled, exercising the authenticated path

### Requirement: Documented script entry points
The run modes SHALL be driven by documented `package.json` scripts (at least:
backends-only, the full native dev loop, and the prod-like docker-compose path).

#### Scenario: Discoverable commands
- **WHEN** a developer inspects `package.json`
- **THEN** scripts exist to start backends-only, the native dev loop, and to build/serve the prod-like stack

