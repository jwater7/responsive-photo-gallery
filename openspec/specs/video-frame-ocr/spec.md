# video-frame-ocr Specification

## Purpose
Text visible in video keyframes is OCR'd, deduplicated across frames, and keyword-searchable through the same `content` field as photos.
(Created by syncing change add-video-embeddings-and-search-filter.)

## Requirements

### Requirement: Video keyframes are OCR'd into the standard text field
The `ocr` enricher SHALL apply to video files (its `applies()` gate widened to
the shared media regexp) and, for a video, SHALL run the configured OCR engine
over each extracted keyframe (the same frames as the visual stage, via the
shared video-frames module) and write the merged result to the same `content`
output field used for images, preserving the engine's confidence filtering.
Frame buffers SHALL be handed to the engine via temporary files (the engine
interface is path-based); temporary files SHALL be removed even on failure.

#### Scenario: On-screen text becomes keyword-searchable
- **WHEN** a video whose frames contain a legible sign is enriched and a
  keyword search for the sign's text runs
- **THEN** the video appears in the results via its `content` field, like a photo
  containing the same sign

#### Scenario: OCR failure soft-fails per file
- **WHEN** the OCR engine fails on a video's frames
- **THEN** the stage records `ocr_error` with no version stamp, temp files are
  cleaned up, and the file is retried on a later scan

### Requirement: Recognized lines are deduplicated across frames
The video OCR branch SHALL deduplicate recognized lines across the sampled
frames using normalized comparison (trimmed, whitespace-collapsed,
case-folded), keeping the first-seen original form of each line, so text
visible in multiple frames is stored once.

#### Scenario: Persistent sign is not repeated
- **WHEN** the same sign is recognized in all three sampled frames
- **THEN** the stored `content` contains that line exactly once
