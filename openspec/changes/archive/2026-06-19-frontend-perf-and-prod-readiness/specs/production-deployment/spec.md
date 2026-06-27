## ADDED Requirements

### Requirement: No insecure default secrets
The deployment SHALL NOT use any insecure built-in default secret and SHALL NOT
require a secret to be supplied to the `docker compose` invocation. Secrets the
application itself owns (e.g. the cookie-signing secret) SHALL be generated with
strong entropy on first run and persisted in the application's auth config. A service
confined to the internal network with no host ports MAY run without an authentication
secret (e.g. MeiliSearch runs keyless) provided no insecure default secret remains.

#### Scenario: App-owned secret generated and persisted
- **WHEN** the application starts without a cookie-signing secret yet persisted
- **THEN** it generates a strong secret, persists it in the auth config, and reuses it on later restarts — with no environment variable and no hardcoded placeholder

#### Scenario: Internal-only search service runs keyless
- **WHEN** the search service starts with no master key configured
- **THEN** it serves only on the internal network (no host ports) and no insecure default master key is present anywhere

#### Scenario: No placeholder remains
- **WHEN** the codebase and compose files are inspected
- **THEN** no hardcoded secret placeholder or insecure default secret remains

### Requirement: Self-contained compose configuration
The production deployment SHALL be fully described by the compose configuration alone:
bringing the stack up SHALL NOT require passing environment variables on the
`docker compose` command line, an external `.env` file, or any other out-of-band
input. Any secret the stack needs SHALL be generated and persisted within the stack.

#### Scenario: Bring up with no external input
- **WHEN** an operator runs the compose up command with no extra environment variables and no `.env` file
- **THEN** the stack starts successfully and provisions any secrets it needs itself

### Requirement: Datastores are not exposed on the host network
The deployment SHALL keep datastore services reachable only on the internal container
network, with no host-published ports for MeiliSearch or Redis.

#### Scenario: No host datastore ports
- **WHEN** the production stack is running
- **THEN** MeiliSearch and Redis are reachable only on the internal network and publish no host ports

### Requirement: Unused Mongo service removed
The deployment SHALL NOT include a MongoDB service, and the application container
SHALL NOT mount a Mongo data directory, since no application code uses Mongo.

#### Scenario: Mongo absent
- **WHEN** the production stack is brought up
- **THEN** no Mongo service runs and no Mongo data directory is mounted into the app

### Requirement: TLS and secure cookies
The deployment SHALL serve over TLS via a reverse proxy and SHALL set authentication
cookies with the `Secure` attribute so credentials are not sent over plaintext.

#### Scenario: Cookie marked Secure behind TLS
- **WHEN** a user authenticates through the TLS-terminating proxy
- **THEN** the auth cookie is set with the `Secure` attribute

### Requirement: Healthchecks, restart, and ordered startup
The deployment SHALL define healthchecks for the application and enrichment services,
SHALL set a restart policy on long-running services, and SHALL order dependent service
startup on health (not mere container start) to avoid boot races.

#### Scenario: Dependent service waits for health
- **WHEN** the stack starts and a dependency is not yet healthy
- **THEN** dependent services wait for the dependency to report healthy before starting

#### Scenario: Crashed service restarts
- **WHEN** a long-running service exits unexpectedly
- **THEN** it is restarted automatically

### Requirement: Reproducible multi-stage image
The application image SHALL build the static frontend export at image-build time in a
build stage, and the runtime stage SHALL serve the prebuilt frontend without the build
toolchain present. The frontend SHALL NOT be built at container startup.

#### Scenario: Frontend prebuilt in the image
- **WHEN** a container starts from the production image
- **THEN** it serves the already-built frontend without running a frontend build and without build toolchain in the runtime layer

### Requirement: Durable volumes for all state
The deployment SHALL persist all stateful data on durable volumes — Docker named
volumes or host bind mounts — including thumbnails, tags, auth (which holds the JWT
key), the album sprite/collage cache, the search index, and the queue store. Host bind
mounts are preferred for this deployment so the data survives Docker volume pruning.

#### Scenario: State survives recreation
- **WHEN** containers are recreated
- **THEN** thumbnails, tags, auth, the sprite cache, the search index, and the queue store persist

### Requirement: Resource limits sized to the build pass
The deployment SHALL set CPU and memory limits on the application service so that a
cold-album build (image decoding alongside the enrichment workload) cannot exhaust host
resources.

#### Scenario: Build cannot OOM the host
- **WHEN** a large cold-album build runs
- **THEN** the app service is bounded by its configured CPU/memory limits
