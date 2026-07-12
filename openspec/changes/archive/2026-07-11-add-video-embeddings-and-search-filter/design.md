# Design: add-video-embeddings-and-search-filter

## Context

Block 1 of video enrichment (archived `add-video-enrichment`) established the
pattern this change extends: **per-enricher `applies()` is the dispatcher** —
no job `type` field, no second queue, one worker for both media kinds. The
walker discovers `.mov/.mp4/.m4v/.webm`; the `geo` enricher already branches on
`VIDEO_FORMAT_REGEXP` and reads metadata via ffprobe (`lib/video-meta.js`,
subprocess `execFile`, no fluent-ffmpeg). `ffmpeg` is in the enrichment image
(Dockerfile) precisely because "the encoder is needed for later keyframe-based
blocks" — this is that block.

Current stage gates (`enrichers/index.js` order: ocr, visual, geo, caption):

| stage   | applies() gate        | video today |
|---------|-----------------------|-------------|
| ocr     | IMAGE_FORMAT_REGEXP   | skipped     |
| visual  | IMAGE_FORMAT_REGEXP   | skipped ← the gap |
| geo     | MEDIA_FORMAT_REGEXP   | runs        |
| caption | IMAGE_FORMAT_REGEXP   | skipped (stays image-only) |

Without `_vectors`, videos score ~0 on the semantic half of hybrid search and
the `rankingScoreThreshold` cuts them (Search #2). Relevant machinery that must
keep working: `pipeline.embeddingLost` (re-embed when Meili purged a vector),
`needsEmbedOptOut` (`_vectors:{image:null}` on partial updates to vector-less
docs — the map-cells incident), soft-fail `<stage>_error` markers, force
re-scan scoped by stage+album, delta/reap.

Constraints: prod CPU is an AMD FX-6300 (no hardware codecs) but enrichment is
a background queue — throughput, not latency. Meili is `getmeili/meilisearch:
v1.47.0`. The OCR engine interface is `recognize(absPath)` (path, not buffer)
and native.js already uses temp files internally for preprocessing.

## Goals / Non-Goals

**Goals:**
- Videos rankable in hybrid/smart search: per-keyframe CLIP vectors + a
  metadata-text vector, stored as a Meili multi-vector.
- Zero-shot tags for videos (keyword recall parity with photos).
- Keyframe OCR → standard `content` field, deduped across frames.
- An `excludeVideos` search flag + persisted search-page toggle.
- No mass re-embedding of the existing image library.

**Non-Goals:**
- Video renditions/transcoding for playback (TODO Video #1, separate).
- Scene detection / smart keyframe selection (fixed 20/50/80% sampling).
- Video captions (`caption` enricher stays image-only; videos have no embedded
  caption metadata worth parsing).
- Filtering videos from the **map** (they are pinned content there; the API
  flag is reusable later if wanted).
- Changing the smart-search threshold calibration (known separate issue — this
  change makes videos *candidates*, it does not fix the flat score curve).

## Decisions

### D1: Multi-vector storage — individual frame vectors + text vector
Store `_vectors.image = [frame@20%, frame@50%, frame@80%, embedText(place +
filename)]`. Meili `userProvided` embedders accept multiple embeddings per
document per embedder and rank by the best-matching vector.

- **Why max-sim over mean-pool:** a query matching *one scene* matches the
  video; pooling dilutes distinct scenes into a mush vector. The text vector
  rides along as one more entry, giving videos semantic rank from place/filename
  even when no frame matches visually (user decision: not redundant with
  keyword search — it catches fuzzy semantic matches, e.g. "beach" vs a
  filename/place of "Cannon Beach").
- **Alternatives:** single pooled vector (simpler, worse recall, was the
  original sketch); separate text embedder in Meili (second embedder config,
  more moving parts, rejected).
- **Tags still need one vector:** derive `tagsFor()` from the mean-pooled
  frame vectors (pool → renormalize), not the text vector (which would
  tautologically tag the filename).
- **De-risk first (spike):** verify v1.47 accepts the array form at the
  configured dimensions and ranks max-sim, and that `getDocument(...,
  {retrieveVectors:true})` returns a shape `pipeline.hasEmbedding` already
  parses (`{embeddings:[[...]...]}`). This plane has a history of Meili
  silently failing whole index tasks on vector shape issues — prove the
  contract against a live Meili before building on it.

### D2: Frame extraction — ffmpeg pipes, ~1280px, one shared lib
New `enrichment/src/lib/video-frames.js` beside `video-meta.js`, same
subprocess idiom:
1. `ffprobe` the duration (cheap, ~50ms). The visual stage cannot read geo's
   stored `duration` because **visual runs before geo** in stage order on a
   first pass.
2. For each of 20/50/80% of duration: `ffmpeg -ss <t> -i <file> -frames:v 1
   -vf scale=…1280 long edge… -f image2pipe -c:v png -` → PNG **buffer** (user
   decision: pipes; temp files only where an interface forces them, see D4).
3. Every subprocess call sets a **timeout** and kills on expiry — closing the
   known corrupt-video-hangs-ffmpeg gap class (`video-meta.js` sets only
   `maxBuffer` today; fix it while here).

- **Why 1280px:** big enough for OCR to read signs/titles; CLIP's processor
  downscales to its input size anyway, so one extraction serves both stages.
- **Why fixed percentages over ffmpeg `thumbnail` filter:** the filter decodes
  many 4K frames to pick a "representative" one — heavy on the FX-6300 for
  marginal gain; 3 spread samples is the standard cheap video-CLIP approach.
- **Failure = soft-fail:** extraction/probe errors throw → pipeline records
  `visual_error`/`ocr_error` (no version stamp, nothing durable) → retried on
  a later scan. Same contract as every other stage.

### D3: Shared extraction via single-entry memo
`video-frames.js` memoizes the last extraction keyed by `absPath`. The
pipeline runs a file's stages sequentially (ocr → visual), so a single-entry
memo means one ffmpeg pass serves both stages with no cache-size policy, no
invalidation surface, and no cross-file leakage.
- **Alternative:** each stage extracts independently — simpler but doubles the
  decode cost per video; rejected since the memo is ~5 lines.

### D4: OCR-on-frames — temp-file handoff, cross-frame line dedup
Widen `ocr.applies` to `MEDIA_FORMAT_REGEXP`; video branch: for each frame
buffer, write a temp PNG, call the configured engine's `recognize(tmpPath)`,
unlink in `finally`. Merge results by **normalized line dedup** (trim,
collapse whitespace, case-fold for comparison; keep first-seen original) so a
sign visible in all three frames lands once. Join surviving lines into the
standard `content` field; confidence handling mirrors the image path.
- **Why temp files here despite D2's pipes:** the engine interface is
  `recognize(absPath)` and native.js already round-trips temp files
  internally; changing the engine interface to buffers is invasive and buys
  nothing (user decision: pipes *unless an interface forces otherwise*).
- **Expectation:** catches persistent on-screen text (signs, titles), not
  transient captions — documented, acceptable.

### D5: No version bumps; videos enqueue by construction
Videos have never been stamped `visual_version`/`ocr_version` (applies() was
false), so widening the gate makes `isCurrent` fail for them on the next scan
while every image doc remains current. **Deliberately no bump** of
`visual.version` — a bump would force re-embedding ~60k images at ~3–4s each.

### D6: excludeVideos filter — `NOT mime_type IN [...]` + scan-time backfill
- `routes/enrichment-api.js` `/search`: `body.excludeVideos` (boolean, same
  pattern as `excludeInferred`) appends
  `NOT mime_type IN ["video/mp4", ...]` with the MIME list derived from
  `rpg-media-types` (video extension set → MIME map) — single source of truth,
  a new registry format is filtered with no code change.
- `lib/meili.js`: add `mime_type` to `filterableAttributes`.
- **Backfill:** `mime_type` is a creation-time base field (monorepo-era); older
  docs may lack it, and `NOT IN` semantics on a missing attribute must not be
  load-bearing. One line in `pipeline.runFile`'s canonical-path stat-refresh
  branch: stamp `mime_type` when missing. Self-heals on the next scan;
  `needsEmbedOptOut` already guards these vector-less partial updates.
- **Alternatives:** new `media_type: image|video` field (redundant with
  mime_type — rejected); Meili `STARTS WITH "video/"` (experimental feature
  flag — rejected).

### D7: Frontend toggle — URL-persisted, default = videos included
`Form.Check` "hide videos" beside the smart toggle in `pages/search.js`;
plumbed through `doSearch` into the request body; persisted through the router
query like `smart=1` so back/refresh/share keep it. Default off (videos
included — current behavior); hiding is the explicit opt-in.

## Risks / Trade-offs

- **[Meili multi-vector contract wrong]** → spike task first (D1); fallback is
  the pooled single-vector design with the text vector mean-pooled in — a
  localized change to the visual video branch only.
- **[Silent whole-task rejection on vector writes]** → known failure mode
  (userProvided embedder validates every update); spike + a hermetic test that
  writes a multi-vector doc and reads it back via `retrieveVectors`.
- **[ffmpeg hang on corrupt video]** → hard timeout + kill on every subprocess
  call in video-frames.js (and retrofit video-meta.js); soft-fail marker means
  the file retries rather than wedging the queue.
- **[4K decode cost on FX-6300]** → ~20–30s/video total (3 decodes + 3 embeds
  + 3 OCR passes + 1 text embed) in a background queue over hundreds of
  videos — hours of overnight queue time, acceptable; frame count is a config
  knob (`VIDEO_EMBED_FRAMES`, default 3) if it ever isn't.
- **[Very short / still videos]** → clamp sample times into valid range; a
  0/unknown-duration probe soft-fails; identical frames are handled naturally
  (near-identical vectors, dedup collapses OCR lines).
- **[OCR text quality on downscaled frames]** → 1280px long edge chosen for
  OCR legibility; the engine's existing confidence filtering applies; worst
  case is missing text, never wrong-doc corruption.
- **[Old docs without mime_type leak through the filter]** → scan-time
  backfill (D6); until a scan runs, missing-attribute docs may or may not
  match `NOT IN` — bounded, self-healing window.

## Migration Plan

1. Ship code; rebuild the enrichment image (ffmpeg already in Dockerfile —
   this rebuild also closes the archived Block 1 §7 acceptance step).
2. Run a scan (admin Sync): videos enqueue for ocr+visual by construction
   (D5); the stat-refresh backfills `mime_type` on old docs.
3. Verify: a video doc shows `embedded: true`, tags, multi-vector via
   `retrieveVectors`; smart search surfaces a known video; toggle hides it.
4. Rollback: revert image; already-written vectors/text are inert (correct
   data, just unused); no schema migration to unwind.

## Open Questions

- None blocking. Assumption confirmed with user: toggle default = videos
  included. Spike (D1) is sequenced as the first task rather than left open.
