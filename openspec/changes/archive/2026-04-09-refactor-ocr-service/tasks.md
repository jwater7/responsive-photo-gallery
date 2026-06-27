## 1. Entry Point Consolidation

- [x] 1.1 Create unified `src/bin/server.js` with Express app, cron scheduler, and route mounting
- [x] 1.2 Remove old files: delete `watch.js`, `run.js`, `app.js` from `/ocr/src/`
- [x] 1.3 Update docker-compose.yml to change command from `node ocr/src/bin/watch.js` to `node ocr/src/bin/server.js`

## 2. OCR Scanning Module Updates

- [x] 2.1 Add `getAlbumHashes(albumName)` function to `handlers/image-handler.js` that queries MeiliSearch for all hashed documents in given album
- [x] 2.2 Remove file cache logic from `scanAllImages()`: delete `/data/thumbs/.ocr-processed.json` read/write calls
- [x] 2.3 Update `scanAllImages()` to accept optional album names as list or single string; process each album with its hash lookup
- [x] 2.4 Add delta-only logic: skip file processing if hash already exists in MS results

## 3. Progress Tracking Implementation

- [x] 3.1 Initialize `progressByAlbum` object tracking scanned/indexed counts per subdirectory
- [x] 3.2 Increment counters during loop iteration as files are checked and processed
- [x] 3.3 Report progress in scan stats return value: `{ scanned, indexed, failed-ocr, empty_files, durationMs, albumStats }`
- [x] 3.4 Track which album is currently being processed for `/status` endpoint

## 4. Status Endpoint Implementation

- [x] 4.1 Create GET `/api/v1/status` route handler in routes/ocr-api.js or separate file
- [x] 4.2 Return `{"inProgress": false, "progressByAlbum": null, ...}` when idle
- [x] 4.3 Return partial progress object with `currentAlbum`, `scanned`, `indexed` counts when scan in progress
- [x] 4.4 Include `nextScheduledScan` timestamp in response (null if currently running or cron disabled)

## 5. Concurrent Request Handling

- [x] 5.1 Initialize `isScanning` boolean flag at module level before importing handlers/routes
- [x] 5.2 Check flag on POST /ocr-sync request; return `{ status: "running" }` immediately if true
- [x] 5.3 Always set `isScanning = true` at start of scan and clear in finally block
- [x] 5.4 Add console logging for scan state transitions for debugging

## 6. Server Startup and Lifecycle

- [x] 6.1 Initialize MeiliSearch client on startup (not lazy; create once at boot)
- [x] 6.2 Create or recreate "docs" index if not exists when service starts
- [x] 6.3 Start cron scheduler with expression `0 */SCAN_INTERVAL_HOURS * * *`
- [x] 6.4 Listen on port 8080 (from env var OCR_PORT or default 8080)
- [x] 6.5 Handle SIGINT gracefully: stop cron, clear flag, exit after 2 seconds

## 7. Route Simplification

- [x] 7.1 Remove redundant inline handler initialization from routes/ocr-api.js
- [x] 7.2 Refactor POST /ocr-sync to call `handler.scanAllImages()` instead of duplicate logic
- [x] 7.3 Keep only GET /search route (unchanged from original)

---

## Verification Checklist

After implementation, verify:

- [x] Service starts on port 8080 without errors
- [x] No console error about watch.js or run.js still being present
- [x] POST /api/v1/ocr-sync returns immediately when scanning begins
- [x] GET /api/v1/status returns JSON with inProgress:false when idle
- [x] Delta scanning skips files already in MeiliSearch (no duplication)
- [x] Progress by album is reported when scanning multiple subdirectories

---
