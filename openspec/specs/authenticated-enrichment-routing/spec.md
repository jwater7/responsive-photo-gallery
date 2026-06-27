# authenticated-enrichment-routing Specification

## Purpose
TBD - created by archiving change harden-enrichment-routing-dev-modes. Update Purpose after archive.
## Requirements
### Requirement: Enrichment routes require authentication
All enrichment proxy endpoints SHALL be served under the authenticated API tree
(`/api/v1/enrich/*`) behind the same passport JWT middleware as the rest of the
gallery API, honoring the existing `NO_AUTHENTICATION=yes` bypass.

#### Scenario: Unauthenticated request to an enrichment route
- **WHEN** a client without a valid JWT cookie requests `/api/v1/enrich/search` (with `NO_AUTHENTICATION` unset)
- **THEN** the request is rejected as unauthorized (401) and is not proxied to the enrichment service

#### Scenario: Authenticated request to an enrichment route
- **WHEN** a logged-in client requests an `/api/v1/enrich/*` endpoint
- **THEN** the request is proxied to the enrichment service and the response is returned

#### Scenario: Auth bypass for development
- **WHEN** the gallery runs with `NO_AUTHENTICATION=yes`
- **THEN** enrichment routes are reachable without a JWT, exactly like the rest of `/api/v1/`

### Requirement: Auth gate is shared, not duplicated
The JWT gate SHALL have a single definition (e.g. `lib/require-auth.js`) reused by
both the gallery API and the enrichment mount; the enrichment proxy SHALL NOT
copy the gating logic.

#### Scenario: Single source of truth
- **WHEN** the routing code is inspected
- **THEN** both `/api/v1/*` and `/api/v1/enrich/*` derive their auth gate from one shared definition, and `routes/enrich.js` does not redefine it

### Requirement: Enrichment feature stays removable
The enrichment proxy SHALL remain a single self-contained module (`routes/enrich.js`),
removable by deleting that file and its single mount line in `app.js` without
affecting gallery operation (the shared gate helper, used by the gallery API,
stays).

#### Scenario: Feature removed
- **WHEN** `routes/enrich.js` and its mount line in `app.js` are removed
- **THEN** the gallery builds and serves browse/auth/thumbnail/upload normally with no dangling imports

#### Scenario: Isolation guard still passes
- **WHEN** `npm run test:isolation` runs
- **THEN** it passes and confirms no gallery hot-path module depends on the enrichment plane

### Requirement: No unauthenticated host-exposed enrichment port by default
The default/prod compose configuration SHALL NOT publish the enrichment
service's port to the host; the enrichment service SHALL be reachable only on the
internal container network. Direct host publishing SHALL exist only in a
dev/deps override.

#### Scenario: Default compose port exposure
- **WHEN** the stack is brought up with the default `docker-compose.yml`
- **THEN** the enrichment service has no host-published port and is reachable only from the gallery container over the internal network

#### Scenario: Dev override exposes ports intentionally
- **WHEN** the deps/dev override is used for native development
- **THEN** the enrichment service (and other backends) publish their ports to localhost for the native processes to reach

