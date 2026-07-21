// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Visual enricher — computes the media embedding once and derives both the
 * stored vector(s) (for hybrid semantic search) and zero-shot tags (for
 * explainability and keyword recall) from it.
 *
 * Handles both images and videos (like geo.js, the branch IS the dispatcher —
 * see walk-dir.js):
 *   - image → one CLIP embedding of the file
 *   - video → keyframes (video-frames.js) CLIP-embedded individually, stored
 *             as a Meili MULTI-vector so hybrid search ranks by the
 *             best-matching scene. Frames ONLY — an embedText() vector of the
 *             place/filename was tried and measured out (2026-07-11): CLIP
 *             text↔text cosines are systematically high regardless of meaning
 *             (the modality gap — a gibberish filename scored 0.93 for
 *             "airplane" while real image matches sit ~0.60–0.64), so under
 *             max-sim a text vector makes every video outrank every image on
 *             every query. Place/filename stay searchable through the KEYWORD
 *             half of hybrid search instead.
 *             Tags come from the mean-pooled frame vectors.
 *
 * Output fields:
 *   embedded  (boolean idempotency marker; _vectors isn't returned by getDoc)
 *   tags      (string[])
 *   _vectors  ({ [embedderName]: number[] | number[][] })  - MeiliSearch
 *             userProvided vector (image) or multi-vector (video)
 */

const config = require("../lib/config");
const embedder = require("../lib/embedder");
const labels = require("./visual-labels");
const { keyframes } = require("../lib/video-frames");
const { VIDEO_FORMAT_REGEXP, MEDIA_FORMAT_REGEXP } = require("../lib/walk-dir");
const { isDecodableImage, undecodableError } = require("../lib/decodable");

const debugErr = require("debug")("responsive-photo-gallery:visual:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

// Version stamps whose stored embedding is REUSABLE by the current version:
// bumps that changed only what is DERIVED from the embedding (tag logic,
// video vector layout), not the embedding model/preprocess itself. A v2 pass
// over a v1 image doc recomputes tags from the stored vector in milliseconds
// instead of re-running CLIP (~3-4s × the whole library = days on the prod
// CPU). An admin Force scan bypasses reuse (ctx.forced) — that stays the
// escape hatch for "really re-embed" (e.g. after an EMBED_MODEL change).
const EMBED_REUSABLE_VERSIONS = new Set([1]);

function cos(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

function softmax(xs) {
  const max = Math.max(...xs);
  const exps = xs.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

// Label text embeddings are model-dependent, so compute them once lazily.
let labelVectorsPromise = null;
async function labelVectors() {
  if (!labelVectorsPromise) {
    labelVectorsPromise = (async () => {
      const vecs = [];
      for (const label of labels) {
        vecs.push(await embedder.embedText(`a photo of ${label}`));
      }
      return vecs;
    })();
    // Never cache a rejection: one transient failure computing the label
    // vectors would otherwise disable tagging for the worker's lifetime (the
    // same clear-on-failure embedder.load applies to the model itself).
    labelVectorsPromise.catch(() => {
      labelVectorsPromise = null;
    });
  }
  return labelVectorsPromise;
}

async function tagsFor(imageVec) {
  const lvs = await labelVectors();
  const sims = lvs.map((lv) => cos(imageVec, lv));
  const probs = softmax(sims.map((s) => s * config.tagScale));
  const scored = labels
    .map((label, i) => ({ label, p: probs[i] }))
    .sort((a, b) => b.p - a.p);

  // Strip the "a/an/the" article from the stored tag for cleaner keywords.
  const clean = (l) => l.replace(/^(a |an |the )/, "");
  // May be EMPTY: when nothing clears the threshold, CLIP is telling us it
  // doesn't recognize the content — no tag beats a wrong tag. The old forced
  // top-1 fallback stamped an arbitrary argmax label on exactly those docs,
  // and those junk tags then keyword-matched at score 1.0, burying genuine
  // matches (measured 2026-07-11: hundreds of unrelated docs tagged
  // "airplane" outranked a real, correctly-tagged airplane photo).
  return scored
    .filter((s) => s.p >= config.tagThreshold)
    .slice(0, config.maxTags)
    .map((s) => clean(s.label));
}

/** Element-wise mean of same-length vectors, renormalized to unit length. */
function meanPool(vecs) {
  const out = new Array(vecs[0].length).fill(0);
  for (const v of vecs) for (let i = 0; i < v.length; i++) out[i] += v[i];
  for (let i = 0; i < out.length; i++) out[i] /= vecs.length;
  return embedder.normalize(out);
}

/**
 * The existing doc's stored SINGLE image embedding, when it was produced by a
 * reusable version (see EMBED_REUSABLE_VERSIONS) and matches the configured
 * dimensions. getDoc fetches with retrieveVectors, shaped
 * `{ embeddings, regenerate }` (or a bare vector). Multi-vector (video) docs
 * return null — the video branch always re-derives its frames.
 */
function reusableEmbedding(existing) {
  if (!existing || !EMBED_REUSABLE_VERSIONS.has(existing.visual_version)) return null;
  const v = existing._vectors && existing._vectors[config.embedderName];
  if (!v) return null;
  const emb = Array.isArray(v) ? v : v.embeddings;
  if (!Array.isArray(emb)) return null;
  // Bare single vector ([n1, n2, ...]) vs array of embeddings ([[...]]).
  const single = typeof emb[0] === "number" ? emb : emb.length === 1 ? emb[0] : null;
  return Array.isArray(single) && single.length === config.embedDimensions ? single : null;
}

/** Video branch: one CLIP vector per keyframe as a multi-vector (see header). */
async function enrichVideo({ absPath }) {
  let frames;
  try {
    // keyframes() probes duration via videoMeta internally; the memoized
    // extraction is shared with the ocr stage (see video-frames.js).
    frames = await keyframes(absPath);
  } catch (err) {
    debugErr("keyframe extraction failed for %s: %s", absPath, err.message);
    return { error: `keyframe extraction failed: ${err.message}` };
  }

  const frameVecs = [];
  for (const frame of frames) frameVecs.push(await embedder.embedImage(frame));

  let tags;
  try {
    tags = await tagsFor(meanPool(frameVecs));
  } catch (err) {
    debugErr("tagging failed for %s: %s", absPath, err.message);
    return { error: `tagging failed: ${err.message}` };
  }
  return {
    embedded: true,
    tags,
    _vectors: { [config.embedderName]: frameVecs },
  };
}

module.exports = {
  name: "visual",
  // bump when the embedding model or tag logic changes (forces regen on full
  // scan). NB: normally the expensive ~3-4s/image stage — but a bump listed in
  // EMBED_REUSABLE_VERSIONS recomputes tags from the stored vector instead
  // (cheap), so only genuinely new/forced files pay for CLIP.
  // v2: junk top-1 tag fallback removed + video metadata-text vector removed
  //     (both measured rank polluters, 2026-07-11). v1 image embeddings are
  //     reusable; v1 VIDEO docs re-derive (their stored multi-vector still
  //     contains the text vector, which must be dropped).
  version: 2,
  outputFields: ["embedded"],
  // Produces a MeiliSearch userProvided vector (_vectors[embedderName]). The
  // pipeline verifies that vector actually exists before treating the stage as
  // current, so a vector Meili purged (embedder-config change) re-embeds instead
  // of hiding behind the surviving `embedded` marker. See pipeline.embeddingLost.
  embeds: true,
  applies: (file) => MEDIA_FORMAT_REGEXP.test(file.relPath),
  async enrich(ctx) {
    const { absPath, existing, forced } = ctx;
    if (VIDEO_FORMAT_REGEXP.test(ctx.file.relPath)) return enrichVideo(ctx);

    // Tag-only refresh: reuse the stored embedding when this run exists only
    // because of a derived-output version bump (and the operator didn't Force).
    // Skips the decode gate too — no pixels are read on this path.
    const reused = forced ? null : reusableEmbedding(existing);

    // Capability gate (probed once, no decode attempt): a registry image
    // format this sharp build can't decode soft-fails with a stable reason —
    // recorded as `visual_error`, no version stamp — so a later HEIF-capable
    // build picks the file up on re-scan (see lib/decodable.js).
    if (!reused && !isDecodableImage(absPath)) {
      return { error: undecodableError(absPath) };
    }
    const vec = reused || (await embedder.embedImage(absPath));
    let tags;
    try {
      tags = await tagsFor(vec);
    } catch (err) {
      debugErr("tagging failed for %s: %s", absPath, err.message);
      // Soft failure: the pipeline records `visual_error` (no version stamp, no
      // output merged) so the stage retries on a later scan, instead of the doc
      // being stamped current with permanently empty tags. The embedding is
      // recomputed on that retry — acceptable for this rare path, and it keeps
      // the soft-fail contract uniform (a failed stage writes nothing durable).
      return { error: `tagging failed: ${err.message}` };
    }
    const out = { embedded: true, tags };
    // On reuse the stored vector is untouched — omitting _vectors keeps Meili
    // from re-indexing identical values (and needsEmbedOptOut stays quiet:
    // the doc is embedded).
    if (!reused) out._vectors = { [config.embedderName]: vec };
    return out;
  },
};
