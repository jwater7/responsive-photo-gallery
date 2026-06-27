# ocr-search Capability

## Overview

The OCR search capability indexes extracted text from images and exposes a full-text search API through MeiliSearch. When enabled, users can query the gallery's image content for keywords.

## Requirements

The capability must:

1. **Ingest OCR Data**
   - Accept JSON documents with `path`, `hash`, `content`, `confidence`, `last_modified`, `mime_type`
   - Index documents into MeiliSearch at `docs` collection  
   - Use `hash` as primary key for upserts (avoids duplicate content)

2. **Handle Search Queries**
   - Accept JSON body with `query` and optional pagination (`offset`, `limit`)
   - Forward queries to MeiliSearch index `docs`
   - Return results sorted by relevancy ranking
   - Include result metadata: path, hash, content snippet, confidence, mime_type, file_size

3. **Error Handling**
   - Return 503 if MeiliSearch connection fails
   - Handle missing index with 404 or auto-create behavior per config
   - Gracefully handle empty results (return `[]`)

## API Contract

### Endpoint: POST /api/v1/search

```json
POST /api/v1/search
Content-Type: application/json

Body: {
  "query": "cat dog house",
  "offset": 0,
  "limit": 20
}
```

**Success Response (200):**
```json
{
  "query": "cat dog house",
  "results": [
    {
      "path": "/albums/kitchen/image.jpg",
      "hash": "sha256hash123...",
      "content": "A cat sitting on the sofa with a dog nearby in kitchen living space.",
      "confidence": 0.92,
      "mime_type": "image/jpeg",
      "file_size": 1248576
    }
  ],
  "total": 15
}
```

**Empty Results (200):**
```json
{
  "query": "",
  "results": [],
  "total": 0
}
```

## Configuration

Environment variables for search service:

| Variable | Default | Description |
|----------|---------|-------------|
| `IMAGE_PATH` | `/images/` | Root directory containing albums/images to scan |
| `MEILI_HOST_URL` | `http://meilisearch:7700` | MeiliSearch host address |
| `MEILI_MASTER_KEY` | (empty) | Master API key for authentication |

## Dependencies

- **MeiliSearch** v0.38.0+ (text search backend)
- No external dependencies beyond base Node runtime

## Security Notes

- Search endpoint is internal-only, meant to be called by main app or via docker-compose network
- No JWT auth required (handled at main app layer if proxying through)
- Avoid logging search queries or results due to potential PII in OCR content
