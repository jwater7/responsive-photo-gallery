#!/usr/bin/env node
// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Build-time CLIP model prefetch.
 *
 * Downloads the local CLIP weights (EMBED_MODEL/EMBED_DTYPE) into the
 * transformers.js cache at MODEL_CACHE_PATH so the running service makes zero
 * outbound calls (fully air-gapped, like the baked GeoNames + tesseract data).
 * load() pulls the processor, tokenizer, and both the vision and text encoders;
 * a tiny embedText() warmup proves the text path end-to-end and fails the build
 * loudly if anything is missing.
 */

const embedder = require("../lib/embedder");
const config = require("../lib/config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The weights come from HuggingFace's CDN; a single edge can be transiently
// unreachable (ConnectTimeout) even when the network is healthy. Retry so one
// bad edge doesn't fail the whole image build. Re-import is fresh each attempt
// because embedder caches its model promise only on success.
async function prefetch(attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await embedder.load();
      await embedder.embedText("warmup");
      return;
    } catch (err) {
      const code = err.cause?.code || err.code || err.message;
      if (i === attempts) throw err;
      const backoff = 3000 * i;
      console.warn(`prefetch attempt ${i}/${attempts} failed (${code}); retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

(async () => {
  await prefetch();
  console.log(`Prefetched ${config.embedModel} (${config.embedDtype}) -> ${config.modelCachePath}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
