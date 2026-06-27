# OCR Progress Tracking Specification

## Overview

The OCR scanning service tracks processing progress by album/subdirectory and provides immediate acknowledgment when POST /api/v1/ocr-sync is called. Scanning occurs in the background while HTTP responses return promptly.

## Request Handling Behavior

### When Scan Is Not Running

```json
// POST /api/v1/ocr-sync request arrives
{ "type": "full" }
```

Behavior:

1. Set `isScanning = true` atomically
2. Begin background scan process immediately
3. Send HTTP 200 response **immediately** (before scan completes)
4. Scan continues in background thread/promise chain

Response on success (after completion):

```json
{
  "result": {
    "scanned": 3420,
    "indexed": 87,
    "failed-ocr": 5,
    "empty_files": 2,
    "durationMs": 185000
  },
  "type": "full",
  "timestamp": "2024-04-08T02:25:30.000Z"
}
```

### When Scan Is Already Running

```json
// POST /api/v1/ocr-sync request arrives while scanning
{ "type": "delta" }
```

Behavior:

1. Check `isScanning` flag
2. If true, return immediately with status (no new scan started)
3. Do NOT block HTTP client waiting for background work

Response on already running scan:

```json
{
  "status": "running",
  "message": "Scan in progress"
}
```

> **Note**: New requests will be handled sequentially (one at a time). If user makes two rapid calls, first one starts scan and returns immediately, second one sees it's running and also returns early. This prevents resource exhaustion while allowing HTTP clients to respond gracefully.

## Progress Response Format

### Status Endpoint Response Schema

```json
// GET /api/v1/status
{
  "inProgress": false, // true if currently scanning
  "currentAlbum": "holidays", // name of album being processed (if applicable)
  "progressByAlbum": {
    // Optional: only include if scanning in progress
    "/albums/holidays": {
      "scanned": 158, // Files checked in this album
      "indexed": 152 // New/changed files OCR'd this cycle
    },
    "/albums/trips-europe": {
      "scanned": 0,
      "indexed": 0
    }
  },
  "nextScheduledScan": null // ISO timestamp of next cron run (if enabled)
}
```

### Fields in ProgressByAlbum Object

| Field     | Type    | Description                                                           |
| --------- | ------- | --------------------------------------------------------------------- |
| `scanned` | integer | Files checked against MeiliSearch (already indexed or needs scanning) |
| `indexed` | integer | New/changed files successfully OCR'd and upserted to index            |

## Implementation Notes

### In-Memory State Only

- All progress state exists in memory only
- State is lost when server restarts
- MeiliSearch documents = source of truth for which files are OCR'd
- No persistent cache file (unlike legacy `./data/thumbs/.ocr-processed.json`)

### Concurrent Scan Prevention

```javascript
// Simple boolean lock prevents overlapping scans
let isScanning = false; // Single-process state only

function handleOcrSyncRequest(type) {
  if (isScanning) {
    // Return immediately - can't start new scan
    return responseJson({ status: "running" });
  }

  isScanning = true; // Take ownership of scanning slot

  try {
    performScan();
    return responseJson(succesfulStats);
  } finally {
    isScanning = false; // Always clear flag, even on error
  }
}
```

### Album-Aware Progress Tracking

Progress reports are grouped by album for better UX:

1. Scan starts with empty progress object: `{}`
2. First album processed (e.g., "holidays"):
   ```javascript
   progressByAlbum = {
     "/albums/holidays": { scanned: 0, indexed: 0 },
   };
   ```
3. After processing 50 files in that album:
   ```javascript
   progressByAlbum = {
     "/albums/holidays": { scanned: 50, indexed: 48 },
   };
   ```

## Example Usage Flows

### Flow 1: Background Scanning

```bash
# User starts cron scan (or manual trigger)
curl -X POST http://localhost:3000/api/v1/ocr-sync \
  -H "Content-Type: application/json" \
  -d '{"type": "full"}'

<!-- Response instant -->
{"result":{"scanned":3420,"indexed":87,"failed-ocr":5}...}

# Later, user queries status while scan running (simulated)
curl http://localhost:3000/api/v1/status

<!-- Shows inProgress:true with partial progress -->
```

### Flow 2: Concurrent Requests

```bash
# Multiple users trigger scans rapidly
curl -X POST http://localhost:3000/api/v1/ocr-sync -d '{"type":"full"}'
curl -X POST http://localhost:3000/api/v1/ocr-sync -d '{"type":"delta"}'

<!-- First returns with stats -->
{"result":{"scanned":100,"indexed":95}...}

<!-- Second sees scan in progress, returns early -->
{"status":"running"}
```

### Flow 3: Search During Scan

```bash
# While OCR is running in background
curl -X POST http://localhost:3000/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "cat"}'

<!-- MeiliSearch handles this concurrently -->
{"query":"cat","results":[{...}, {...}]...}
```

---
