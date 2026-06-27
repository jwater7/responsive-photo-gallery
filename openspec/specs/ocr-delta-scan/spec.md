# Delta-Only OCR Scanning Specification

## Overview

The OCR indexing service performs **delta-only scans**, meaning it only processes files that are not already in the MeiliSearch index. Before each scan, the service queries MeiliSearch for all indexed documents in the current album and skips any files whose SHA256 hash already exists in the search index.

## Document Structure

All OCR'd documents must contain the following fields:

### Required Fields

| Field           | Type               | Description                                           | Example                      |
| --------------- | ------------------ | ----------------------------------------------------- | ---------------------------- |
| `hash`          | string (SHA256)    | **Primary key** - Unique identifier for deduplication | `"abc123..."`                |
| `content`       | string             | Full OCR text extraction                              | `"A cat sitting on the..."`  |
| `confidence`    | number [0-1]       | Tesseract confidence score                            | `0.95`                       |
| `last_modified` | ISO 8601 timestamp | File modification time                                | `"2024-04-08T12:30:00Z"`     |
| `mime_type`     | string             | Detected MIME type                                    | `"image/jpeg"`               |
| `file_size`     | integer            | File size in bytes                                    | `1234567`                    |
| `path`          | string             | Relative path from IMAGE_PATH                         | `/albums/holidays/beach.jpg` |
| `album`         | string (required)  | Directory name for album filtering                    | `"holidays"`                 |

### Optional Fields

| Field  | Type  | Description                    |
| ------ | ----- | ------------------------------ | --------------------- |
| `tags` | array | User-defined or extracted tags | `["beach", "summer"]` |

## Scanning Behavior

### Delta-Only Logic

```javascript
// Pseudocode for scan decision
async function shouldScanFile(fileHash, albumName) {
  // Query MeiliSearch for all documents in album
  const indexedDocs = await meiliClient.index("docs").search("", {
    filter: `album="${albumName}"`,
    limit: 500,
    attributesToRetrieve: ["hash"],
  });

  const indexedHashes = new Set(indexedDocs.hits.map((hit) => hit.hash));

  // Only scan if hash doesn't exist
  return !indexedHashes.has(fileHash);
}
```

### Query Performance

- Albums with <50,000 documents: Single query at scan start, all hashes loaded into memory Set
- Large albums (>50K docs): Consider paginated queries or database partitioning (future enhancement)

## Concurrent Access Model

### Read Operations (Search)

- **Always concurrent** - POST /api/v1/search queries MeiliSearch directly
- No coordination with scanning thread needed
- Atomic writes from OCR scans don't interfere with read queries

### Write Operations (OCR Scan)

- Use `updateDocument(hash, doc)` for upsert semantics
- MeiliSearch handles document replacement atomically
- Partial documents should not occur (if they do → re-index entire index)

## Error Handling

### When Document Is Missing from Index

```javascript
// Expected behavior when file needs OCR
await meiliClient.index("docs").updateDocument(fileHash, doc);
// Returns: { taskUid: 1 }
```

### When Re-scanning Same File (Already Indexed)

```javascript
// Uploading a file that's already in MeiliSearch is OK
// updateDocument() will overwrite with same hash + content
await meiliClient.index("docs").updateDocument(fileHash, docWithSameContent);
// Returns: { taskUid: 2 }
```

## Performance Considerations

### Recommended Batch Size

- Query batch limit: **500 documents per query** (adjust based on album size)
- For large albums: Either paginate queries or split into sub-directories

### Hash Computation Overhead

- SHA256 computation is required for every file check (cannot be cached)
- Consider parallelizing hash computation before OCR extraction if processing many files

---
