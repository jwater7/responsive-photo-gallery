# ocr-enrichment

OCR becomes one enricher in the pipeline. Supersedes the OCR-specific behavior of
`ocr-delta-scan` / `ocr-progress-tracking` / `ocr-status-api` (removed on archive).

## ADDED Requirements

### Requirement: Native local OCR engine
The OCR enricher SHALL extract text using the native `tesseract` binary
(optionally with ImageMagick preprocessing), behind a swappable engine
interface, and SHALL run fully locally with no network calls.

#### Scenario: Extract text from an image
- **WHEN** the OCR enricher processes a supported raster image containing text
- **THEN** it writes `content` (extracted text) and `confidence` (0–1) to the document

#### Scenario: Image with no text
- **WHEN** the image contains no detectable text
- **THEN** `content` is written empty and the file is not treated as an error

### Requirement: Supported inputs only
The OCR enricher SHALL process raster formats (jpg/png/tiff/bmp/webp) and SHALL
skip video and formats tesseract cannot read.

#### Scenario: Non-image file encountered
- **WHEN** the walker yields a video or unsupported file
- **THEN** the OCR enricher does not attempt extraction on it

### Requirement: Idempotent OCR
The OCR enricher SHALL skip extraction when `content` already exists for the
file's hash.

#### Scenario: Re-scan of an already-OCR'd file
- **WHEN** a file's hash already has `content`
- **THEN** the OCR enricher does not re-run for that file
