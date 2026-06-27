## Context

The OCR indexing service currently exists as fragmented code in `ocr/ocr-indexer.js` and `ocr/routers/ocr-api.js`. These files have been referenced in docker-compose but never properly integrated. The implementation contains runtime bugs (missing `child_process` imports) and unclear architectural intent.

From the AGENTS.md documentation, the OCR service was intended as a background worker using cron scheduling to scan images, extract text via Tesseract/OCR, and index results in MeiliSearch for full-text search capabilities. The existing implementation used hash-based change detection to avoid reprocessing unchanged files.

This change refactors it into a proper microservice that:
- Has clean separation from main app (independent codebase)
- Can be deployed as separate container (or sidecar) in docker-compose
- Has its own HTTP API for internal communication only
- Follows the same patterns and conventions as the main application

## Goals / Non-Goals

**Goals:**
- Create standalone OCR microservice with Express app entry point
- Implement clean architecture matching base API patterns
- Provide `/api/v1/search` endpoint for full-text queries
- Provide `/api/v1/ocr-sync` endpoint for manual scan triggers
- Support 24-hour cron scheduling + manual trigger modes
- Share volume mounts with main app (`/data/thumbs`, `/data/meili`)
- Use only internal communication (no public-facing endpoints)

**Non-Goals:**
- Direct client access to OCR API (exposed only via main app proxy if needed)
- Public authentication endpoints (main app handles auth layer)
- Real-time file watching (stick with cron scheduling pattern)
- Processing videos (only supported formats: jpg/jpeg/png)

## Decisions

### Decision 1: Separate Express App per Service

**What:** OCR service has its own Express app entry at `ocr/src/app.js` with only `/api/v1/*` routes mounted.

**Why:** Maintains separation of concerns, allows independent deployment and scaling, matches microservice pattern from proposal.

**Alternatives Considered:**
- Sharing single Express process (would couple scanning to main app lifecycle)
- Using worker threads within same process (complexity around event loop sharing)

**Chosen Approach:** Separate container with internal HTTP communication via docker-compose.

---

### Decision 2: No Authentication on OCR Endpoints

**What:** OCR service API endpoints (`/search`, `/ocr-sync`) require no JWT authentication and are intended for internal use only.

**Why:** Main app is the controller—any external trigger goes through main app's API layer which handles auth. Direct client access to CRUD album content isn't needed.

**Alternatives Considered:**
- Shared JWT strategy with main app (adds complexity, not needed)
- API key authentication (overkill for internal service)

**Chosen Approach:** Plain HTTP endpoints accessible only by main app via same host or docker-compose network discovery.

---

### Decision 3: Hash-Based Change Detection with Persistent Cache

**What:** OCR indexer computes SHA256 hash of each image file and stores `{hash, indexed}` state in `/data/thumbs/.ocr-processed.json`.

**Why:** Hash-based detection is deterministic—unchanged files = same hash = skip processing. This is faster than re-processing entire scan every cycle.

**Alternatives Considered:**
- File timestamp comparison (racy: file could be rewritten without touching mtime)
- Content-addressable storage / content hashing to dedicated DB (overcomplicated, MeiliSearch already stores indexed docs)

**Chosen Approach:** SHA256 hash stored in cache file persists across container restarts since it's on shared volume.

---

### Decision 4: ImageMagick Preprocessing for OCR Quality

**What:** When `convert` command is available, use `convert -density 300 -quality 90` to resize/normalize image before Tesseract extraction.

**Why:** Higher density improves OCR accuracy; consistent quality reduces variability. Falls back to direct Tesseract if ImageMagick unavailable.

**Alternatives Considered:**
- Always require ImageMagick (platform-specific, not portable)
- Lower quality settings (poorer OCR accuracy)
- Skip preprocessing for speed (lower quality results)

**Chosen Approach:** Try `convert` first silently; fallback gracefully to direct Tesseract if unavailable. Log deprecation if ImageMagick can't be found.

---

### Decision 5: Docker Compose Three-Service Model

**What:** Run three containers in production docker-compose:
- `rpg-app-local`: Main Express app (port 3000)
- `rpg-ocr-indexer`: OCR microservice (internal port 8080)
- `rpg-meilisearch`: Search backend container

**Volume Mounts:**
- `/data/thumbs/:rw` → shared state for thumbnails and OCR cache
- `/data/meili/:rw` → MeiliSearch persistent storage
- `/images:ro` → read-only image directory

**Why:** Internal communication via service names (`http://rpg-ocr-indexer:8080`), volumes provide shared state without IPC libraries.

---

## Risks / Trade-offs

[Risk] **Memory accumulation in cron scan**: Cron scans continuously without stopping until complete, which could block other requests on same container.

**Mitigation:** OCR service runs as separate container (not in main app) so scanning doesn't impact frontend requests. Could add queue-based processing if scale becomes issue.

[Risk] **Hash collision edge case**: SHA256 is computationally expensive but very reliable at detecting change vs no-change.

**Mitigation:** SHA256 provides excellent collision resistance even with 10M+ files. Alternative hash algorithms are overkill here.

[Risk] **ImageMagick not installed on all platforms**: Some host environments may lack ImageMagick.

**Mitigation:** Graceful fallback to direct Tesseract CLI when `convert` command fails. Logs warning but continues. User can ensure image processors are available.

[Trade-off] **Separate container adds network hop**: Main app must POST to `http://rpg-ocr-indexer:8080/api/v1/...` adding network latency vs direct calls if in-process.

**Mitigation:** Docker-compose on local dev and shared volumes for production make IPC library unnecessary (shared volumes cheaper than complex IPC setup). Keep separate containers simple.

