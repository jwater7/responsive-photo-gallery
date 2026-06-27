# GET /status Endpoint Specification

## Overview

Provides lightweight scan state monitoring without blocking or exposing internal implementation details. Returns minimal information needed for health checks and dashboard updates.

## Request

```http
GET /api/v1/status
Content-Type: application/json

<!-- Body not expected/used -->
```

## Response Format

### When Scan Is Not Running (Normal State)

```json
{
  "inProgress": false,
  "currentAlbum": null,
  "progressByAlbum": null,
  "nextScheduledScan": "2024-04-09T01:35:00.000Z"
}
```

### When Scan Is In Progress

```json
{
  "inProgress": true,
  "currentAlbum": "holidays",
  "progressByAlbum": {
    "/albums/holidays": {
      "scanned": 234,
      "indexed": 228
    },
    "/albums/office": {
      "scanned": 0,
      "indexed": 0
    }
  },
  "nextScheduledScan": null
}
```

## Field Definitions

### `inProgress`

| Value   | Meaning                                                         |
| ------- | --------------------------------------------------------------- |
| `false` | No active scan, service idle between cycles or awaiting trigger |
| `true`  | Active OCR scanning is running on background thread             |

### `currentAlbum`

- **Type**: string OR null
- **Value**: Name of album currently being processed (if any)
- **null**: Service not currently processing files
  - Could mean: idle, waiting for next cron cycle, scan just completed, or error state

> **Why nullable**: The endpoint is non-blocking and lightweight. No need to track "which" album specifically if multiple albums process in one batch.

### `progressByAlbum`

- **Type**: object OR null
- **null**: Either not scanning, scanning single album already tracked by currentAlbum, or progress tracking disabled
- **object**: When detailed per-album progress is being collected during active scan

### Object Fields: ProgressByAlbum[<path>]

| Field     | Type    | Description                                            | Nullable                         |
| --------- | ------- | ------------------------------------------------------ | -------------------------------- |
| `scanned` | integer | Files checked (hash exists in MS or not) in this album | No, 0 if processing              |
| `indexed` | integer | Successfully OCR'd and upserted files                  | No, 0 if none yet for this batch |

### `nextScheduledScan`

- **Type**: ISO 8601 datetime OR null
- **null**: Cron disabled (SCAN_INTERVAL_HOURS = 0) or currently executing scheduled scan
- Value: Timestamp of next cron trigger after current operation completes

## Implementation Constraints

### What NOT to Include

```javascript
// DO NOT expose these private implementation details
{
  ❌ "processingCurrentFile": "/albums/holidays/main.jpg",      // Internal state
  ❌ "hashesInMemory": [],                                      // Implementation detail
  ❌ "meiliClient": { ... },                                    // External dependency ref
}

// ✅ Only expose stable, external-facing state
{
  "inProgress": true,
  "currentAlbum": "holidays",
  "progressByAlbum": {...},
  "nextScheduledScan": null
}
```

### Performance Considerations

- Query MeiliSearch hash count for `scanned` counter (or track internally during batch query)
- Do NOT call MS for every /status request (add caching layer: update on scan progress events)
- Keep response under 10ms latency target
- Use cached values from recent batch operation when available

## Example Dashboard API Calls

### Health Check (Quick Polling)

```javascript
// Frontend polls every 30 seconds
async function healthCheck() {
  const res = await fetch("/api/v1/status");
  const status = await res.json();

  if (!status.inProgress) {
    console.log("✓ OCR service healthy and idle");
  } else {
    console.log(
      `🔄 OCR scanning albums: ${status.currentAlbum || "unspecified"}`,
    );
  }
}
setInterval(healthCheck, 30000);
```

### Dashboard Widget (Rich Status)

```javascript
// Admin dashboard calls every 5 seconds
async function updateDashboard() {
  const res = await fetch("/api/v1/status");
  const status = await res.json();

  if (status.inProgress && status.progressByAlbum) {
    return {
      headline: `Scanning ${Object.keys(status.progressByAlbum).length} albums`,
      progress: Object.entries(status.progressByAlbum)
        .map(([path, stats]) => ({
          album: path.split("/").pop(), // Just "holidays" not "/albums/holidays"
          totalFiles: stats.scanned,
          processedNewFiles: stats.indexed - (stats.scanned - stats.indexed),
          progressPercent: stats.scanned
            ? Math.round((stats.indexed / stats.scanned) * 100)
            : 0,
        }))
        .flat(),
      statusColor: "orange", // Active processing color
    };
  } else if (status.inProgress && !status.progressByAlbum) {
    return {
      headline: `Scanning albums in queue`,
      progress: [],
      statusColor: "yellow",
    };
  } else {
    return {
      headline: "Ready for OCR scheduling",
      progress: [],
      statusColor: "green",
    };
  }
}
```

## Error Handling

### Standard Response (Success)

```json
// Always returns success JSON even if idle
{
  "inProgress": false,
  "currentAlbum": null,
  "progressByAlbum": null,
  "nextScheduledScan": "2024-04-09T01:35:00.000Z"
}
```

### MeiliSearch Connection Failure

```json
// When MS is unreachable, return best-effort based on last known state
{
  "inProgress": null, // We don't know if cron was active at time of failure
  "currentAlbum": null,
  "progressByAlbum": null,
  "nextScheduledScan": null,
  "error": "MeiliSearch unavailable" // Optional indicator field
}
```

### Other Errors

- Any error querying MS or calculating progress → return `{ inProgress: null, ... }`
- Don't expose stack traces to clients (log to service logs)
- Return HTTP 200 with `null` values rather than HTTP 5xx for transient errors

## Rate Limiting Considerations

### Recommended Usage Pattern

```bash
# Admin dashboard: Poll every 5 seconds if actively monitoring scan progress
# Health check systems: Poll every 30 seconds for basic status
# Other consumers: No strict limit, reasonable default is once per minute
```

### When to Optimize

If multiple clients poll simultaneously during long scans:

1. Add response caching (e.g., Redis or Node.js in-memory store)
2. Cache duration: Match `SCAN_INTERVAL_HOURS` or 30 seconds for progress updates
3. Invalidate cache on scan completion events
4. Return cached data with `ETag` headers

---
