// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/** Central environment-derived configuration for the enrichment service. */

function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isNaN(v) ? fallback : v; // respects 0 (e.g. cron disabled)
}

// Shared runtime config (CONFIG_PATH, excludes.json) is owned by the rpg-config
// package — the gallery writes it; the worker reads it fail-open via rpg-config's
// loadExcludes() (see src/lib/walk-dir.js). Nothing config-dir lives here anymore.

module.exports = {
  imagePath: process.env.IMAGE_PATH || "/images",
  meiliHostUrl: process.env.MEILI_HOST_URL || "http://rpg-meilisearch:7700",
  meiliApiKey: process.env.MEILI_MASTER_KEY || "",
  redisUrl: process.env.REDIS_URL || "redis://rpg-redis:6379",
  ocrEngine: process.env.OCR_ENGINE || "native",
  ocrLang: process.env.OCR_LANG || "eng",
  ocrPreprocess: /^(1|true|yes)$/i.test(process.env.OCR_PREPROCESS || ""),
  // Cap the OCR input resolution. Feeding Tesseract a full-res phone photo is
  // pathological: past ~2500px on the long edge its layout/LSTM cost explodes
  // (a 4032px image measured ~36 min vs <1s at 1500px). This is a SAFETY cap,
  // not a quality knob, so it's on by default and independent of OCR_PREPROCESS
  // (which only controls the grayscale/contrast quality pass). Set
  // OCR_DOWNSCALE=false for corpora where fine print needs every pixel (e.g.
  // scanned documents).
  ocrDownscale: !/^(0|false|no|off)$/i.test(process.env.OCR_DOWNSCALE || ""),
  // Long-edge ceiling (px) for the downscale cap. 1500 sits well below the
  // measured ~2500px cliff while keeping enough detail for photo text, and
  // matches the preprocess resize target so the two passes agree.
  ocrDownscaleMaxDim: intEnv("OCR_DOWNSCALE_MAX", 1500),
  // Hard wall-clock cap (ms) on a single Tesseract invocation, so a file that
  // still lands past the cliff (downscale disabled, or `convert` failed and we
  // fell back to the original) fails fast into `ocr_error` instead of pinning a
  // worker slot for tens of minutes. Derived: ~100x a normal 1500px OCR (~1-2s)
  // yet ~18x below the 36-min full-res blowup — never trips legitimate work,
  // always reclaims a wedged one. 0 disables the cap.
  ocrTimeoutMs: intEnv("OCR_TIMEOUT_MS", 120000),
  // Drop OCR words below this Tesseract confidence (0-100). Tesseract's per-word
  // `conf` is a 0-100 likelihood, so 50 is the more-likely-wrong-than-right
  // midpoint — the principled floor for filtering noise, not a tuned literal.
  // The biggest noise win for photo OCR; on by default.
  ocrMinConfidence: intEnv("OCR_MIN_CONFIDENCE", 50),
  // Page segmentation mode. Empty = Tesseract default (PSM 3, full page). Set to
  // 11/12 (sparse text) for photos. Left a knob because the corpus is mixed
  // (sparse photo text vs full scanned documents).
  ocrPsm: process.env.OCR_PSM || "",
  // When set, pass `--tessdata-dir` to select alternate models — e.g. the
  // bundled tessdata_best LSTM data at /data/tessdata-best (more accurate, but
  // slower than the default fast `eng` package, so opt-in pending profiling).
  ocrTessdataPrefix: process.env.OCR_TESSDATA_PREFIX || "",

  // --- Semantic embeddings (local CLIP via transformers.js) -----------------
  // EMBED_MODEL: any CLIP-family model works via env (same code path). Default
  // is CLIP ViT-B/16 — higher quality than B/32 at a small footprint. Other
  // CLIP-family options to try later (uncomment one):
  //   "Xenova/clip-vit-base-patch32"    // faster, lower quality, 512-d
  //   "Xenova/clip-vit-large-patch14"   // higher quality, LARGE footprint, 768-d
  //   "jinaai/jina-clip-v1"             // strong retrieval, larger
  // Non-CLIP architectures (e.g. SigLIP "Xenova/siglip-base-patch16-224") are
  // higher quality per byte but need a code branch in embedder.js (different
  // model classes), not just an env change.
  embedModel: process.env.EMBED_MODEL || "Xenova/clip-vit-base-patch16",
  // Quantization: "q8" keeps the memory footprint small; "fp16"/"fp32" trade
  // footprint for a little more quality.
  embedDtype: process.env.EMBED_DTYPE || "q8",
  modelCachePath: process.env.MODEL_CACHE_PATH || "/data/models",
  embedderName: "image", // MeiliSearch userProvided embedder name
  // Must match EMBED_MODEL's output dimension (B/16 & B/32 = 512; Large = 768).
  embedDimensions: intEnv("EMBED_DIMENSIONS", 512),
  // Hybrid search blend when the caller doesn't specify (0 = keyword only,
  // 1 = semantic only).
  defaultSemanticRatio: parseFloat(process.env.DEFAULT_SEMANTIC_RATIO || "0.5"),
  // Zero-shot tagging: softmax temperature scale over labels, min probability,
  // and max tags per image.
  tagScale: parseFloat(process.env.TAG_SCALE || "50"),
  tagThreshold: parseFloat(process.env.TAG_THRESHOLD || "0.05"),
  maxTags: intEnv("MAX_TAGS", 6),

  // --- Geo (EXIF + offline reverse geocoding) -------------------------------
  // GeoNames dumps bundled into the image at build time (no runtime network).
  geonamesCitiesPath: process.env.GEONAMES_CITIES || "/data/geonames/cities15000.txt",
  geonamesAdmin1Path: process.env.GEONAMES_ADMIN1 || "/data/geonames/admin1CodesASCII.txt",
  geonamesCountryPath: process.env.GEONAMES_COUNTRY || "/data/geonames/countryInfo.txt",

  // Realtime filesystem watcher. Enabled by default; set WATCH_ENABLED=false to
  // turn it off and rely solely on the periodic reconcile (e.g. on hosts where
  // the inotify watch limit can't be raised for a large library).
  watchEnabled: !/^(0|false|no|off)$/i.test(process.env.WATCH_ENABLED || ""),
  reconcileIntervalHours: intEnv("SCAN_INTERVAL_HOURS", 24),
  // Periodic liveness/progress heartbeat (minutes). Only emits while work is in
  // flight, so idle logs stay quiet. 0 disables it.
  heartbeatIntervalMin: intEnv("HEARTBEAT_INTERVAL_MIN", 30),
  port: intEnv("ENRICHMENT_PORT", 8080),
  workerConcurrency: intEnv("WORKER_CONCURRENCY", 2),
  intEnv,
};
