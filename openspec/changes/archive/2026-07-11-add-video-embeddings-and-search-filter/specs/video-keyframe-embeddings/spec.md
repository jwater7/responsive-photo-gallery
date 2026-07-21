# video-keyframe-embeddings

## ADDED Requirements

### Requirement: Videos receive keyframe CLIP embeddings as a multi-vector
The `visual` enricher SHALL apply to video files (its `applies()` gate widened
to the shared media regexp) and, for a video, SHALL extract keyframes at 20%,
50%, and 80% of the clip's duration, embed each frame with the existing CLIP
image embedder, embed the text `place + filename` with the CLIP text embedder,
and store all resulting vectors as a MeiliSearch multi-vector under
`_vectors[<embedderName>]` (one entry per frame plus one text entry), together
with the same `embedded: true` idempotency marker used for images. Sample
times SHALL be clamped to the clip's valid range for very short clips.

#### Scenario: Video becomes rankable in hybrid search
- **WHEN** a video is enriched and a smart (hybrid) search runs whose query
  semantically matches any one of the video's keyframes or its place/filename
  text
- **THEN** the video ranks by its best-matching stored vector and appears in
  the results instead of being cut by the ranking-score threshold for lack of
  vectors

#### Scenario: Existing image library is not re-embedded
- **WHEN** the widened visual enricher is deployed and a scan runs
- **THEN** videos (never stamped with `visual_version`) are enqueued and
  embedded, and image docs whose stored version and outputs are current are
  skipped — no `visual.version` bump, no mass re-embedding

#### Scenario: Extraction or probe failure soft-fails
- **WHEN** ffprobe or ffmpeg fails or exceeds its timeout for a video (e.g.
  corrupt file)
- **THEN** the stage records `visual_error` with no version stamp and no
  partial output, the subprocess is killed, and the file is retried on a later
  scan

### Requirement: Videos receive zero-shot tags from pooled frame vectors
The `visual` enricher SHALL derive a video's zero-shot tags by mean-pooling
the keyframe vectors (renormalized) and running the existing label scoring;
the metadata-text vector SHALL NOT contribute to tag derivation.

#### Scenario: Video tags support keyword recall
- **WHEN** a video whose keyframes depict a beach is enriched
- **THEN** the doc carries tags derived from the pooled frame embedding (e.g.
  "beach") and matches keyword searches on those tags like a photo would

### Requirement: Keyframe extraction is shared, piped, and time-bounded
A shared video-frames module SHALL probe duration and extract frames as PNG
buffers via ffmpeg stdout pipes (no intermediate files) at approximately
1280px long edge, SHALL set a hard timeout on every ffprobe/ffmpeg subprocess
(killing the child on expiry), and SHALL memoize the most recent extraction
per file path so consecutive stages of the same file's pipeline pass share one
extraction. The frame count SHALL be configurable (default 3).

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
