# semantic-search

Find images by what they show, not just text in them. All models and inference
are local; no cloud, no outbound calls.

## ADDED Requirements

### Requirement: Local image embeddings
The pipeline SHALL embed each image with a local CLIP-family model
(ONNX/transformers.js, CPU) and store the vector on the document as a
`userProvided` embedding; MeiliSearch SHALL NOT make outbound embedding calls.

#### Scenario: Embed a new image
- **WHEN** the embedding enricher processes a file whose hash has no image vector
- **THEN** it computes the vector locally and stores it as `_vectors.image`

### Requirement: Local tags and optional caption
The pipeline SHALL produce `tags[]` via local zero-shot classification (CLIP
against a curated label vocabulary) and MAY produce a local `caption`.

#### Scenario: Tag an image
- **WHEN** the tagging enricher processes an image
- **THEN** it writes `tags[]` derived locally, with no network call

### Requirement: Hybrid search
The search endpoint SHALL fuse keyword matching (over `content`, `caption`,
`tags`) with vector similarity over the image embedding, expose a tunable
semantic-vs-keyword weight, and embed the query text locally at query time.

#### Scenario: Contextual query
- **WHEN** a user searches "baseball"
- **THEN** results include visually related images (e.g. mitts, bats, stadiums) ranked by the fused keyword+vector score

#### Scenario: Combined filters
- **WHEN** a search includes `album`, geo, or `taken_at` filters
- **THEN** the hybrid query applies them together in a single MeiliSearch request

### Requirement: Local-only background inference
Embedding, tagging, and captioning SHALL run locally as background batch stages,
keyed and skipped by content hash like every enricher; reduced local-model
capability versus hosted models is accepted.

#### Scenario: Re-scan with embeddings present
- **WHEN** a file's hash already has an image vector
- **THEN** the embedding enricher does not recompute it

### Requirement: Search degrades cleanly
When MeiliSearch is unreachable, the search endpoint SHALL return a clean error
(503) and SHALL NOT affect gallery browsing.

#### Scenario: Search backend down
- **WHEN** a search request arrives and MeiliSearch is unreachable
- **THEN** the endpoint returns 503 and the gallery remains fully usable
