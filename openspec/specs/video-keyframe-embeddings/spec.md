# video-keyframe-embeddings Specification

## Purpose
Videos participate in hybrid/smart semantic search alongside photos: keyframes are CLIP-embedded and stored as a MeiliSearch multi-vector (best-match ranking), with zero-shot tags derived from the pooled frame vectors.
(Created by syncing change add-video-embeddings-and-search-filter; amended 2026-07-11: the metadata-text vector was removed after measurement — CLIP text↔text scores are high regardless of relevance, so a text vector under max-sim made every video outrank every image on every query. Place/filename remain searchable through the keyword half of hybrid search.)

## Requirements

### Requirement: Videos receive keyframe CLIP embeddings as a multi-vector
The `visual` enricher SHALL apply to video files (its `applies()` gate widened
to the shared media regexp) and, for a video, SHALL extract keyframes at 20%,
50%, and 80% of the clip's duration, embed each frame with the existing CLIP
image embedder, and store the frame vectors as a MeiliSearch multi-vector
under `_vectors[<embedderName>]` (one entry per frame), together with the same
`embedded: true` idempotency marker used for images. The multi-vector SHALL
contain ONLY image-modality (frame) vectors — never a text-encoder vector,
whose modality-gap scores would dominate max-sim ranking for every query.
Sample times SHALL be clamped to the clip's valid range for very short clips.

#### Scenario: Video becomes rankable in hybrid search
- **WHEN** a video is enriched and a smart (hybrid) search runs whose query
  semantically matches any one of the video's keyframes
- **THEN** the video ranks by its best-matching frame vector and appears in
  the results instead of being cut for lack of vectors

#### Scenario: Existing image library is not mass re-embedded
- **WHEN** the visual enricher's version is bumped for a change that only
  affects outputs DERIVED from the embedding (tag logic, vector layout)
- **THEN** image documents whose stored embedding came from a
  reuse-compatible version are refreshed by recomputing the derived outputs
  from the stored vector (no CLIP inference), while an operator Force scan
  still recomputes the embedding itself

#### Scenario: Extraction or probe failure soft-fails
- **WHEN** ffprobe or ffmpeg fails or exceeds its timeout for a video (e.g.
  corrupt file)
- **THEN** the stage records `visual_error` with no version stamp and no
  partial output, the subprocess is killed, and the file is retried on a later
  scan

### Requirement: Videos receive zero-shot tags from pooled frame vectors
The `visual` enricher SHALL derive a video's zero-shot tags by mean-pooling
the keyframe vectors (renormalized) and running the existing label scoring.

#### Scenario: Video tags support keyword recall
- **WHEN** a video whose keyframes depict a beach is enriched
- **THEN** the doc carries tags derived from the pooled frame embedding (e.g.
  "beach") and matches keyword searches on those tags like a photo would

### Requirement: Tags are never fabricated below the confidence threshold
Zero-shot tagging (images and videos alike) SHALL return only labels whose
probability clears the configured threshold, up to the configured maximum —
and SHALL return an empty tag list when nothing clears it. A forced
highest-scoring fallback tag is prohibited: fabricated tags keyword-match at
full score and bury genuinely relevant results.

#### Scenario: Unrecognizable content gets no tags
- **WHEN** a file is embedded and no label clears the tag threshold
- **THEN** the document's `tags` is empty, and the document does not
  keyword-match any label term it was never confidently assigned

### Requirement: Keyframe extraction is shared, piped, and time-bounded
A shared video-frames module SHALL probe duration and extract frames as PNG
buffers via ffmpeg stdout pipes (no intermediate files) at approximately the
OCR downscale ceiling on the long edge, SHALL set a hard timeout on every
ffprobe/ffmpeg subprocess (killing the child on expiry), and SHALL memoize the
most recent extraction per file path so consecutive stages of the same file's
pipeline pass share one extraction. The frame count SHALL be configurable
(default 3).

#### Scenario: One extraction serves OCR and visual
- **WHEN** the pipeline runs the ocr stage and then the visual stage for the
  same video in one pass
- **THEN** ffmpeg frame extraction executes once and the second stage consumes
  the memoized frames

#### Scenario: Multi-vector round-trip is verified
- **WHEN** a multi-vector document is written to the deployed MeiliSearch
  version and fetched with `retrieveVectors`
- **THEN** the write is accepted (task succeeds), and the returned embeddings
  shape satisfies the pipeline's `hasEmbedding` check so `embeddingLost` does
  not re-trigger
