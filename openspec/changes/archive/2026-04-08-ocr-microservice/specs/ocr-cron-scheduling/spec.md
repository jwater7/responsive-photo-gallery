# ocr-cron-scheduling Capability

## Overview

The OCR cron scheduling capability provides a background job that periodically scans all image files in the designated directory. When enabled, it runs continuously scanning every N hours and skipping unchanged files using hash-based change detection.

## Requirements

The capability must:

1. **Start Background Cron Job**
   - On container startup if `OCR_CRON_ENABLED=true` AND `SCAN_INTERVAL_HOURS > 0`
   - Otherwise skip cron initialization, only allow manual API triggers

2. **Execute Scan Cycle**
   - At scheduled time (minute 0 of every N hours) or on manual trigger
   - Walk IMAGE_PATH recursively for supported image formats
   - Compute hash and compare with cached state
   - Process files where hash differs from cache OR not yet indexed
   - Update `/data/thumbs/.ocr-processed.json` with new state

3. **Respect Caching**
   - Load cache at start of scan cycle
   - Skip processing if file hash matches cached value
   - Save updated cache after each scan cycle completes

## Environment Variables

| Variable | Default | Required For |
|----------|---------|--------------|
| `IMAGE_PATH` | `/images/` | - |
| `MEILI_HOST_URL` | `http://meilisearch:7700` | - |
| `MEILI_MASTER_KEY` | empty | MeiliSearch authentication (if configured) |
| `SCAN_INTERVAL_HOURS` | `24` | Only for cron mode, set to 0 to disable |
| `OCR_CRON_ENABLED` | Inherits from SCAN_INTERVAL_HOURS | Toggle continuous scanning behavior |

**Cron Mode:** Enable by setting `OCR_CRON_ENABLED=true`. Service will start background scan job on every container restart.

**Manual-Only Mode:** Set `SCAN_INTERVAL_HOURS=0` or leave unset with `OCR_CRON_ENABLED=false`. Only API triggers result in processing.

## Cron Scheduling Pattern

When enabled, cron runs at minute 0 of every N hours:

```javascript
// Example: Every 24 hours at midnight
cron.schedule('0 * 0 * * *', async () => {
  await scanAllImages();
});

// Example via env var SCAN_INTERVAL_HOURS=6 → every 6 hours
cron.schedule(`0 * 6 * * *`, ...);
```

## Manual Trigger API

To trigger immediate scan without cron delay:

```bash
curl -X POST http://rpg-ocr-indexer:8080/api/v1/ocr-sync \
  -H 'Content-Type: application/json' \
  -d '{ "type": "full" }'
```

**Payload Options:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `"full"` (all files) or `"delta"` (only modified) |
| `interval_hours` | number | No | Optional; used if next cron run should respect this interval |

## Container Lifecycle Integration

The OCR service container is configured as a dependent of main app in docker-compose:

```yaml
ocr-indexer:
  depends_on: [meilisearch]
  restart: unless-stopped  # Persistent across crashes/restarts
  command: node ocr-indexer.js watch  # Always watch mode
```

On startup, cron immediately begins monitoring and schedules first run based on interval.

## Error Handling for Cron Mode

- Errors during scan don't stop cron from retrying next cycle
- Failed scans log to stdout (captured by Docker logs)
- Missing MeiliSearch or images don't crash container
- Health checks optional; can verify via API `/api/v1/scan-status`

## Cache Persistence

Caches survive container restart because:
- Volume mount `/data/thumbs` points to persistent storage in `.volumes/data/thumbs/`
- Hash comparison ensures unchanged files are skipped even across restarts
