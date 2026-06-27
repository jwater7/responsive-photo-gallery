# ocr-scanning Capability

## Overview

The OCR scanning capability processes image files in the designated directory, extracts text via optical character recognition (OCR), and indexes results into MeiliSearch using hash-based change detection to avoid reprocessing unchanged files.

## Requirements

The capability must:

1. **Scan Files**
   - Recursively walk `IMAGE_PATH` directory for files matching supported formats (jpg/jpeg/png)
   - Compute SHA256 hash for each file to determine change status
   - Track processed files in cache file `.ocr-processed.json` at `/data/thumbs/`

2. **Extract Text via OCR**
   - Attempt ImageMagick preprocessing: `convert -density 300 -quality 90 /tmp/temp.png`
   - If ImageMagick unavailable, fall back to direct Tesseract extraction
   - Use Tesseract CLI with English language model (`-l eng`)
   - Parse confidence level from Tesseract output (range 0.5-1.0)

3. **Index to MeiliSearch**
   - Create document with keys: `path`, `hash`, `content`, `confidence`, `last_modified`, `mime_type`
   - Use path as string field, hash for unique key if index configured
   - Store full extracted text in `content` field (up to 8k chars max per Meili limits)

4. **Process Mode Options**
   - Full scan: Process all files matching supported formats
   - Delta scan: Only process files where hash ≠ cached hash or not yet indexed

5. **Persistence**
   - Cache file `/data/thumbs/.ocr-processed.json` stores processed state
   - Format: `{ "/path/to/file.jpg": { "hash": "...", "indexed": true } }`
   - Cache survives container restart due to volume persistence

## API Contract

### Endpoint: POST /api/v1/ocr-sync

```json
POST /api/v1/ocr-sync
Content-Type: application/json

Body: {
  "type": "full",      // or "delta"
  "interval_hours": 24 // optional, used for next cron run if applicable
}
```

**Success Response (200):**
```json
{
  "result": "scan_started",
  "type": "full",
  "timestamp": "2024-04-07T21:30:00.000Z"
}
```

**Error Response (503):**
```json
{
  "error": {
    "code": 503,
    "message": "MeiliSearch connection failed: ..."
  }
}
```

## Configuration Options

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `IMAGE_PATH` | `/images/` | Directory path containing albums to scan |
| `SCAN_INTERVAL_HOURS` | `24` | Hours between auto scans (if cron enabled) |
| `OCR_CRON_ENABLED` | Inherits from SCAN_INTERVAL_HOURS | Set to `"true"` for always-on cron mode, unset or `"false"` disables scheduling |

## Cron Scheduling Behavior

When `OCR_CRON_ENABLED=true` and `SCAN_INTERVAL_HOURS > 0`:

- Service starts background cron job on every container restart
- Cron pattern: `0 * ${interval_hours} * * *` executes at minute 0, every N hours
- Before each scan cycle: Load cache → For each image file → Hash → Compare → Process if needed → Save updated cache

When `OCR_CRON_ENABLED=false` or `SCAN_INTERVAL_HOURS=0`:

- No cron job starts
- Only manual API triggers result in processing

## Caching Behavior

Cache file format (JSON):
```json
{
  "/albums/kitchen/image.jpg": {
    "hash": "7d1a2b3c4d5e6f...",
    "indexed": true
  },
  "/albums/outdoor/view.png": {
    "hash": "8f2b3c4d5e6f...",
    "indexed": true
  }
}
```

## Error Handling

- **Missing image file:** Skip and continue processing next file  
- **ImageMagick unavailable:** Fallback to direct Tesseract with warning log
- **MeiliSearch down:** Log error, skip indexing, return 503 on API response
- **Tesseract extraction fails:** Log warning, attempt direct fallback, or mark as failed

## Supported Formats

Only these formats are processed: `jpg`, `jpeg`, `png`. Other files are silently skipped.
