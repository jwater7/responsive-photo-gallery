// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Local CLIP image/text embedder (transformers.js / ONNX, CPU only — no cloud).
 *
 * Loads a CLIP-family model lazily (it's heavy) and exposes embedImage() and
 * embedText() that return L2-normalized vectors in a shared space, so a text
 * query can be matched against image vectors (cross-modal retrieval). The model
 * is configurable via EMBED_MODEL (see config.js for alternatives).
 */

const config = require("./config");

let tf = null; // transformers.js, imported lazily (ESM dynamic import)
let modelsPromise = null;

async function load() {
  if (modelsPromise) return modelsPromise;
  modelsPromise = (async () => {
    tf = await import("@huggingface/transformers");
    tf.env.allowLocalModels = false;
    if (config.modelCachePath) tf.env.cacheDir = config.modelCachePath;

    const model = config.embedModel;
    const dtype = config.embedDtype;

    const [processor, tokenizer, vision, text] = await Promise.all([
      tf.AutoProcessor.from_pretrained(model),
      tf.AutoTokenizer.from_pretrained(model),
      tf.CLIPVisionModelWithProjection.from_pretrained(model, { dtype }),
      tf.CLIPTextModelWithProjection.from_pretrained(model, { dtype }),
    ]);
    return { processor, tokenizer, vision, text };
  })();
  // Don't cache a failed load: a transient fetch error (e.g. a flaky CDN edge
  // on first use) would otherwise poison every later call. Clear so the next
  // call retries from scratch.
  modelsPromise.catch(() => {
    modelsPromise = null;
  });
  return modelsPromise;
}

function normalize(data) {
  let norm = 0;
  for (const v of data) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return Array.from(data, (v) => v / norm);
}

/** Embed an image file into a normalized vector. */
async function embedImage(absPath) {
  const { processor, vision } = await load();
  const image = await tf.RawImage.read(absPath);
  const inputs = await processor(image);
  const { image_embeds } = await vision(inputs);
  return normalize(image_embeds.data);
}

/** Embed a text string into a normalized vector (same space as images). */
async function embedText(text) {
  const { tokenizer, text: textModel } = await load();
  const inputs = tokenizer([text], { padding: true, truncation: true });
  const { text_embeds } = await textModel(inputs);
  return normalize(text_embeds.data);
}

/** Embedding dimensionality (probes the text encoder once). */
async function dimensions() {
  const v = await embedText("dimension probe");
  return v.length;
}

module.exports = { load, embedImage, embedText, normalize, dimensions };
