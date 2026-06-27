
## Why

The OCR indexing service has been partially implemented in the main application's `ocr/` folder but suffers from buggy implementation (missing `child_process` imports) and unclear architecture. We need to refactor it into a proper microservice that:

- Runs independently of the main app (decoupled scanning logic)
- Has its own HTTP API for scan triggers (`POST /api/v1/search`, `/ocr-sync`)
- Uses 24-hour cron scheduling plus manual triggers for robustness
- Can be deployed as separate container in docker-compose
- Is controlled by main app via pass-through triggers (no direct client access)

This separation makes the scanning logic independent, testable, and easier to deploy at scale.

## What Changes

**New:** OCR microservice as standalone sub-project under `ocr/` with own:
- Express app entry (`app.js`) mounting only `/api/v1/*` routes
- Separate routes folder with search/endpoints
- Own swagger documentation at `/api/v1/swagger.json`
- Independent Dockerfile for building

**New API Endpoints (internal-only):**
- `POST /api/v1/search` - Full-text OCR search (queries MeiliSearch)
- `POST /api/v1/ocr-sync` - Manual scan trigger (full or delta)

**Modified:** Main app's docker-compose will reference new microservice container instead of monolithic ocr-worker.

**Removed/Breaking:** Old buggy `ocr-indexer.js` and `ocr/routers/ocr-api.js` implementations will be replaced during refactor.

## Capabilities

### New Capabilities
- **ocr-scanning**: OCR image text extraction, hashing, and MeiliSearch indexing
  - File hash-based change detection via SHA256
  - Tesseract + ImageMagick for quality text extraction
  - Incremental scanning to avoid reprocessing unchanged files
  
- **ocr-search**: Full-text search across indexed image content
  - Queries MeiliSearch with relevancy ranking, typo tolerance
  - Returns OCR text snippets with metadata (path, confidence, file size)
  
- **ocr-cron-scheduling**: Background cron job for periodic scanning
  - Configurable interval via `SCAN_INTERVAL_HOURS` env var
  - Always-on mode scans every N hours without reprocessing
    
- **ocr-manual-trigger**: On-demand full scan via API endpoint
  - Allows bulk upload scenarios to scan immediately
  - Triggered by main app or user-initiated requests

## Impact

**Code:** Creates new `openspec/changes/ocr-microservice/` artifacts. During implementation:
- `ocr/ocr-indexer.js` replaced with refactored `ocr/src/` structure
- `ocr/routers/ocr-api.js` merged into refactored `ocr/routes/*`

**Dependencies:** Adds `express`, `body-parser`, `cors` to OCR service (from main app, not reusing global). Retains `meilisearch`, `node-cron`, `chalk`, `debug`.

**Architecture:** Docker-compose will have separate `rpg-ocr-indexer` container communicating with main `rpg-app-local` on internal port.

