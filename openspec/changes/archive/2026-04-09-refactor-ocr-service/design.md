## Context

The OCR indexing service currently exists as a fragmented microservice with multiple entry points (`watch.js`, `run.js`, `app.js`) in the `/ocr/` directory that are not properly wired together. The service provides both cron-based background scanning and HTTP API endpoints for manual triggers and search queries, but:

- Routes exist in separate files but aren't mounted to any server
- Console logs suggest HTTP endpoints are available when no server ever starts listening
- File paths are duplicated across multiple handlers instead of using module exports properly

**Current Problem**: The architecture is incomplete - POST requests to `/api/v1/ocr-sync` never receive a server response because no Express app is listening on port 8080. Meanwhile, cron scheduling continues in background with no way to query its progress.

**Why Now**: To make the OCR service production-ready for deployment and use as a unified microservice alongside the main photo gallery (`rpg-app-local`) and MeiliSearch search backend.

## Goals / Non-Goals

**Goals:**

- Create single, well-defined entry point (`server.js`) that starts Express server with cron scheduling
- Consolidate route definitions in one place rather than scattered fragments
- Remove file-based state cache since MeiliSearch documents are sufficient source of truth
- Implement delta-only scanning (only OCR files not in MeiliSearch index)
- Track progress by album for better UX during long scans
- Support concurrent requests with intelligent queue management

**Non-Goals:**

- Persisting scan state across server restarts (MeiliSearch = source of truth only)
- Graceful period before allowing same-scan-type triggers (immediately reject overlapping scans)
- Full-text search optimization on MeiliSearch side (handled by MS, not our concerns)

## Decisions

### 1. Single Entry Point (`server.js`) instead of Multiple Modes

**Decision**: Create one unified `src/bin/server.js` that:

- Initializes Express app with all routes mounted
- Starts cron scheduler every `SCAN_INTERVAL_HOURS` (default 24 hours)
- Listens on port 8080 (configurable via env var `OCR_PORT`)

**Alternatives Considered:**

- Keep both `watch.js` (full service) and `run.js` (cron-only) for different deployment modes
- **Rejected**: Adds confusion about which file to run; simple cron-only can be spawned separately if needed

**Rationale**: Simpler deployment model. If only background worker needed, spawn separate process or use Docker job spec instead of full server.

### 2. Delta-Only Scanning via MeiliSearch Query

**Decision**: Before each scan, query MeiliSearch for all documents in target album:

```javascript
const existingHashes = await getAlbumHashes(albumName);
// Then only OCR files whose hash NOT in this Set
```

**Alternatives Considered:**

- Keep file-based cache (`/data/thumbs/.ocr-processed.json`) like legacy implementation
- **Rejected**: Adds unnecessary I/O; hash already computed, no benefit to storing separately from MS
- Use timestamp instead of hash as skip indicator
  - **Rejected**: Timestamps have sub-second granularity issues on different systems; hash is reliable

**Rationale**: MeiliSearch documents ARE our index. If document exists with that hash → file already OCR'd. Remove redundant cache storage.

### 3. In-Memory `isScanning` Flag (No File Locking)

**Decision**: Track active scans with simple boolean flag:

```javascript
let isScanning = false;

async function handleOcrSyncRequest() {
  if (isScanning) {
    return responseJson({ status: "running" }); // Immediate response
  }

  isScanning = true;
  try {
    await performScan();
  } finally {
    isScanning = false;
  }
}
```

**Alternatives Considered:**

- Use POSIX file lock (`/data/thumbs/.ocr-scanning.lock`)
  - **Rejected**: Overkill for single-process deployment; adds complexity and filesystem dependencies
- Query MeiliSearch document count to detect ongoing scan
  - **Rejected**: Too slow (MS query takes ~50ms vs flag check <1ms); state would become stale

**Rationale**: Single container = single process. Simple boolean works perfectly with no persistence needed. If statelessness desired on restart → delete cache file anyway.

### 4. Album-Aware Progress Tracking

**Decision**: During scan, track progress per album/subdirectory:

```javascript
const progressByAlbum = {
  "/albums/holidays": { scanned: 158, indexed: 152 },
  "/albums/trips-europe": { scanned: 0, indexed: 0 }, // Not yet reached
};
```

**Alternatives Considered:**

- Report every single file path in progress object
  - **Accepted**: Good for UX during moderate-sized scans (<100k files)
- Report only "files per second" rate estimate
  - **Rejected**: Less actionable; users want specific albums progressing
- No tracking at all, return null status until scan complete
  - **Rejected**: Wastes HTTP client bandwidth polling the endpoint

**Rationale**: Album-level granularity strikes balance between useful detail and payload size. Each album processed in batch before moving to next.

### 5. Immediate HTTP Response Before Scan Completion

**Decision**: POST `/api/v1/ocr-sync` returns instantly with `{ status: "running" }` if scan already active, or completion stats when done:

```javascript
// If active scan → return immediately (non-blocking)
if (isScanning) return responseJson({ status: "running" });

// If idle → start scan in background thread/promises, return 200 immediately
startScan(); // Fire-and-forget
return responseJson(result);
```

**Alternatives Considered:**

- Block HTTP request until scan completes
  - **Rejected**: Scan could take hours; client times out waiting for backend work
- Return null response if overlapping triggers come in quickly
  - **Rejected**: Ambiguous; clients can't distinguish "new" vs "old" without status field

**Rationale**: Fire-and-forget pattern with immediate acknowledgment is standard for long-running jobs (same idea as cron, just making HTTP client happy).

## Risks / Trade-offs

### [Risk] In-Memory `isScanning` Flag Lost on Restart

- **Risk**: If service restarted while scanning, flag cleared immediately; next request sees false and starts concurrent scan
- **Mitigation**:
  - Check MeiliSearch document count increase rate as secondary indicator
  - If documents being indexed faster than hash can be looked up → warn about possible race

### [Risk] Hash Computation Overhead on Every File

- **Risk**: SHA256 hash required for every file; slow if many files (e.g., 100GB gallery)
- **Mitigation**:
  - Parallelize `computeHash()` calls across multiple files concurrently
  - Consider skipping hash entirely if file size change detected (file too large? → skip anyway)

### [Risk] MeiliSearch Query Rate Limits

- **Risk**: Fetching all hashes upfront could hit MS rate limits on large albums (>1M files)
- **Mitigation**: Paginate queries with `limit: 500` and offset cursor; add retry logic if MS returns errors

### [Risk] Progress Tracking Memory Growth

- **Risk**: If scanning indefinite stream of subdirectories without completion, progress object grows unbounded
- **Mitigation**: Reset per-album progress counter when album scan completes or after each cron cycle

### [Trade-off] No Persistent Scan History (Stateless on Restart)

- **Trade-off**: Last completed scan timestamp not persisted; `/api/v1/status` returns `{ "lastScan": null }`
- **Benefit**: Simpler state machine, less failure points
- **Benefit**: MeiliSearch documents themselves are our persistence layer anyway
- **Workaround if needed**: Query MS `stats.nDocs` change over time to infer last scan timestamp

---
