// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Visual enricher — computes the image embedding once and derives both the
 * stored vector (for hybrid semantic search) and zero-shot tags (for
 * explainability and keyword recall) from it.
 *
 * Output fields:
 *   embedded  (boolean idempotency marker; _vectors isn't returned by getDoc)
 *   tags      (string[])
 *   _vectors  ({ [embedderName]: number[] })  - MeiliSearch userProvided vector
 */

const config = require("../lib/config");
const embedder = require("../lib/embedder");
const labels = require("./visual-labels");
const { SUPPORTED_FORMAT_REGEXP } = require("../lib/walk-dir");

const debugErr = require("debug")("responsive-photo-gallery:visual:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

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
  const picked = scored
    .filter((s) => s.p >= config.tagThreshold)
    .slice(0, config.maxTags)
    .map((s) => clean(s.label));

  return picked.length ? picked : [clean(scored[0].label)];
}

module.exports = {
  name: "visual",
  // bump when the embedding model or tag logic changes (forces regen on full
  // scan). NB: this is the expensive ~3-4s/image stage — only bump deliberately.
  version: 1,
  outputFields: ["embedded"],
  // Produces a MeiliSearch userProvided vector (_vectors[embedderName]). The
  // pipeline verifies that vector actually exists before treating the stage as
  // current, so a vector Meili purged (embedder-config change) re-embeds instead
  // of hiding behind the surviving `embedded` marker. See pipeline.embeddingLost.
  embeds: true,
  applies: (file) => SUPPORTED_FORMAT_REGEXP.test(file.relPath),
  async enrich({ absPath }) {
    const vec = await embedder.embedImage(absPath);
    let tags = [];
    try {
      tags = await tagsFor(vec);
    } catch (err) {
      debugErr("tagging failed for %s: %s", absPath, err.message);
    }
    return {
      embedded: true,
      tags,
      _vectors: { [config.embedderName]: vec },
    };
  },
};
