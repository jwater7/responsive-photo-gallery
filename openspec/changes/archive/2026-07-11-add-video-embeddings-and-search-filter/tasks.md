# Tasks: add-video-embeddings-and-search-filter

## 1. Spike: Meili multi-vector contract (de-risk D1 first)

- [x] 1.1 Against a live Meili v1.47 (compose deps), write a doc with
      `_vectors.image = [[...],[...]]` at the configured embedder dimensions;
      confirm the index task **succeeds** (this plane's failure mode is silent
      whole-task rejection) and fetch with `retrieveVectors: true` to record
      the returned shape → task succeeded; shape `{embeddings: [[…]×4], regenerate}`
- [x] 1.2 Confirm `pipeline.hasEmbedding` accepts that returned shape (so
      `embeddingLost` won't re-trigger), and that hybrid search ranks the doc
      by its best-matching vector (query near one vector, far from others)
      → max-sim confirmed (best-vector score 1.0 beat 0.8 control; pooled would be 0.625)
- [x] 1.3 Capture findings as a hermetic test (write multi-vector doc → read
      back → hasEmbedding true) → `test/multi-vector-meili.test.js`, passes
      against live Meili v1.47

## 2. Shared keyframe extraction (`lib/video-frames.js`)

- [x] 2.1 Implement duration probe + N-frame extraction (default 3 at
      20/50/80%, clamped for short clips): ffmpeg `-ss <t> … -f image2pipe
      -c:v png -` → PNG buffers, long-edge scale derived from
      OCR_DOWNSCALE_MAX (frames feed both OCR and CLIP; OCR's cap is the max
      useful edge), `execFile` idiom matching video-meta.js
- [x] 2.2 Hard timeout + child kill on every ffprobe/ffmpeg call; error →
      throw (stage soft-fail contract); retrofit the same timeout onto
      `video-meta.js`'s ffprobe
- [x] 2.3 Single-entry memo keyed by absPath so consecutive stages of one
      file share one extraction; `VIDEO_EMBED_FRAMES` config knob (default 3)
      wired through `lib/config.js` + `config-view.js`
- [x] 2.4 Unit tests: frame count/clamping on a tiny fixture video, timeout
      kill on a hung command, memo hit across two callers
      (`test/video-frames.test.js`, 20/20 with video-meta suite)

## 3. Visual enricher video branch

- [x] 3.1 Widen `visual.applies` to `MEDIA_FORMAT_REGEXP`; video branch:
      frames → `embedder.embedImage` per frame (RawImage from PNG buffer),
      text vector from `embedText(place + filename)`, store
      `_vectors[embedderName] = [frames..., text]`, `embedded: true`
      (place precedence: stored doc place > probe GPS reverse-geocoded via
      shared `geonames.placeString` — visual runs before geo, so first pass
      derives place from its own probe)
- [x] 3.2 Tags from mean-pooled + renormalized frame vectors via existing
      `tagsFor()` (text vector excluded); keep the image path byte-identical
      (no `visual.version` bump — verified via isCurrent test)
- [x] 3.3 Bypass the image decodable-gate for videos; probe/extract/embed
      failures return `{ error }` → `visual_error` soft-fail
- [x] 3.4 Tests: video doc gets N+1 vectors + tags + embedded marker; current
      image docs skip; corrupt video soft-fails with no version stamp
      (`test/visual-video.test.js`, 11/11 with visual regressions)

## 4. OCR enricher video branch

- [x] 4.1 Widen `ocr.applies` to `MEDIA_FORMAT_REGEXP`; video branch: shared
      frames → temp PNG per frame → `engine.recognize(tmpPath)` → unlink in
      `finally`
- [x] 4.2 Cross-frame line dedup (trim/collapse-whitespace/case-fold compare,
      keep first-seen original); join into the standard `content` field
      (NB: the OCR output field is `content`, not `text` — specs corrected);
      confidence = mean over text-bearing frames
- [x] 4.3 Tests: repeated sign stored once, distinct per-frame lines all kept,
      engine failure → `ocr_error` + temp cleanup, image OCR path unchanged
      (`test/ocr-video.test.js`, 25/25 with ocr regressions)

## 5. Search filter (API + backfill)

- [x] 5.1 Derive the video MIME list from rpg-media-types — new
      `VIDEO_MIME_TYPES` export (deduped ext→MIME projection); no literal
      list in search code
- [x] 5.2 Add `mime_type` to `filterableAttributes` in `lib/meili.js`;
      `/search` accepts `excludeVideos` → append `NOT mime_type IN [...]`
      (pattern: `excludeInferred`); NOT-form semantics (complement matches
      attribute-missing legacy docs) VERIFIED against live Meili v1.47
- [x] 5.3 Backfill: in `pipeline.runFile`'s canonical-path stat-refresh
      branch, stamp `mime_type` when missing (rides `needsEmbedOptOut` for
      vector-less docs)
- [x] 5.4 Tests: route filter assembly + composition, NOT-IN semantics live,
      backfill canonical/duplicate/no-op cases
      (`test/search-exclude-videos.test.js`, `test/pipeline-mime-backfill.test.js`, 8/8)

## 6. Frontend toggle

- [x] 6.1 "Hide videos" `Form.Check` beside the smart toggle in
      `pages/search.js`; state → `excludeVideos` in the `doSearch` body;
      default off; flipping re-runs the active search immediately
      (changeSort semantics)
- [x] 6.2 Persist through the router query (`videos=0`) alongside
      `smart`/`sort` (restore on load, 4th element of the search identity)
- [x] 6.3 Frontend tests (vitest harness): toggle sends the flag, URL
      round-trip restores it, default sends nothing, immediate re-run
      (`test/search-hide-videos.test.js`, 4/4; full workspace suite green)

## 7. Acceptance (deploy-side)

- [x] 7.1 Rebuild the enrichment image + scan — DONE on the LOCAL compose
      stack (prod rebuild+scan still pending, tracked in TODO.md): all 5
      fixture videos gained `embedded` + 4 multi-vectors (retrieveVectors) +
      tags (ocean clip → fish/ocean/swimming) + place/date; `content` empty
      is the legitimate no-text-in-frames case
- [x] 7.2 Verified live (local): smart search ranks the ocean video FIRST
      (previously invisible); `excludeVideos` strips all videos and composes
      with keyword+filters; worker logs show videos `ran ocr, visual, geo`
      with no image mass re-enqueue (current stages skipped). Toggle UX
      covered by the vitest suite; prod verification pending deploy
- [x] 7.3 Update TODO.md: closed Video #2 and Search & lightbox #2 (moved to
      TODO-DONE.md with the prod-deploy note + smart-search threshold caveat)
