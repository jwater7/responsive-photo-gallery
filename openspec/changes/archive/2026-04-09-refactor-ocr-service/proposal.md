# Why

The OCR indexing service currently has a fragmented architecture with multiple entry points (`watch.js`, `run.js`, `app.js`) that duplicate logic and aren't properly wired together. The service attempts to provide both cron-based background scanning AND HTTP API endpoints, but the two concerns are mixed incompletely - routes exist in separate files but aren't mounted to any server, and console output suggests HTTP endpoints are available when no server ever starts listening.

**Why now**: The current state is non-functional for API requests while still maintaining cron scheduling. This creates confusion about how to deploy the service and makes it impossible to use features like manual scan triggers or search queries. Consolidating into a unified service with clean separation of concerns will make the OCR service production-ready, predictable, and maintainable.

---

# What Changes

## New Entry Point

- Create `src/bin/server.js` - Single consolidated entry point that combines Express server, cron scheduler, and HTTP routing
- Replace fragmented files: DELETE `src/bin/watch.js`, `src/bin/run.js`, `src/app.js`

## Smart Delta-Only Scanning

- Query MeiliSearch for all documents in current album before processing
- Only OCR files whose hashes don't exist in MeiliSearch (delta scanning)
- No file cache persistence - MeiliSearch documents are single source of truth
- Remove `/data/thumbs/.ocr-processed.json` cache logic from handlers

## Unified State Management

- Simple in-memory `isScanning` flag for concurrent request coordination
- No state persists across server restarts (MeiliSearch = source of truth)
- GET /status endpoint returns current scanning state and next scheduled time

## Progress Tracking by Album

- Track per-file progress during scan, organized by subdirectory/album
- POST /ocr-sync responds immediately with "running" status while scan executes in background
- Progress reporting grouped by album for better UX (e.g., "processing holidays album")

## Endpoint Behavior Matrix

### POST /api/v1/ocr-sync

| Scenario         | Response                                            |
| ---------------- | --------------------------------------------------- |
| Scan not running | Return 200 with stats on completion                 |
| Scan in progress | Return 200 immediately with `{ status: "running" }` |

### GET /api/v1/status

Returns current scanning state, last album being processed, and next scheduled scan time

### POST /api/v1/search

- Unchanged - always queries MeiliSearch directly
- Runs concurrently with any OCR scans (atomic writes handle dedup)
- No coordination needed for read operations

## File Structure Changes

**To create:**

- `src/bin/server.js` (unified entry point)

**To modify:**

- `src/handlers/image-handler.js` - Remove file cache logic, add `getAlbumHashes()` function, update `scanAllImages()` for delta-aware scanning

**ToDelete:**

- `src/bin/watch.js`
- `src/bin/run.js`
- `src/app.js` (router only, now in server.js)

---

# Capabilities

### New Capabilities

#### ocr-delta-scan

Delta-only OCR scanning that queries MeiliSearch for existing album documents and only processes files not yet indexed. Uses `album` field in documents for efficient batch queries.

#### ocr-progress-tracking

Per-file progress tracking during scans, organized by album/subdirectory. Provides immediate acknowledgment when POST /ocr-sync is called with optional progress details.

#### ocr-status-api

GET endpoint that returns current scanning state without blocking or reading partial scan results. No persistence layer beyond MeiliSearch documents.

---

# Impact

## Affected Code

- `src/handlers/image-handler.js` - Core OCR processing logic, cache removal, album-aware querying
- `src/bin/server.js` (NEW) - Consolidated entry point with Express + cron
- `src/routes/ocr-api.js` - May be simplified to delegate to handler exports

## Affected APIs

All existing endpoints maintained but with improved behavior:

- `/api/v1/ocr-sync` - Now properly handles concurrent requests
- `/api/v1/search` - Unchanged behavior, concurrent reads supported
- NEW `/api/v1/status` - Scan state monitoring

## Dependencies

- `meilisearch`, `node-cron`, `express`, `body-parser` - No changes needed
- MeiliSearch index schema change: documents must include `album` field for album filter queries

---
