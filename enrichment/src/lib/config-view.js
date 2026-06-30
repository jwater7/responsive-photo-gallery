// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Secret-safe, categorized, read-only views of the effective runtime config for
 * the admin "Configuration" panel. Split by the process that OWNS each setting
 * so neither side ever guesses the other's values:
 *
 *   workerConfig()  — what the WORKER uses (OCR, embeddings/tags, scan/watcher).
 *                     The worker publishes this to Redis on boot; the API can't
 *                     see the worker's env, so it never reports defaults for it.
 *   serviceConfig() — what the API/service process owns (search blend, infra
 *                     connections). The API reports this directly from its env.
 *
 * Secrets are never included: MEILI_MASTER_KEY is omitted entirely, and URLs are
 * reduced to host-only so a credential embedded in REDIS_URL or MEILI_HOST_URL
 * can't leak.
 */

const config = require("./config");

/** Drop any path/userinfo so `redis://user:pass@host:6379/0` becomes `redis://host:6379`. */
function hostOnly(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch (_) {
    return "(set)";
  }
}

function entry(label, env, value, def) {
  const raw = process.env[env];
  return {
    label,
    env,
    value,
    default: def,
    source: raw != null && raw !== "" ? "env" : "default",
  };
}

/** Config owned by the WORKER (the processing plane). Published to Redis on boot. */
function workerConfig() {
  const c = config;
  return [
    {
      category: "OCR",
      items: [
        entry("Engine", "OCR_ENGINE", c.ocrEngine, "native"),
        entry("Language", "OCR_LANG", c.ocrLang, "eng"),
        entry("Min confidence (0-100)", "OCR_MIN_CONFIDENCE", c.ocrMinConfidence, 50),
        entry("Page segmentation (PSM)", "OCR_PSM", c.ocrPsm || "(Tesseract default 3)", "(Tesseract default 3)"),
        entry("Preprocess", "OCR_PREPROCESS", c.ocrPreprocess, false),
        entry("Preprocess via ImageMagick", "OCR_PREPROCESS_USE_MAGICK", c.ocrPreprocessUseMagick, false),
        entry("Downscale input", "OCR_DOWNSCALE", c.ocrDownscale, true),
        entry("Downscale max (px)", "OCR_DOWNSCALE_MAX", c.ocrDownscaleMaxDim, 1500),
        entry("OCR timeout (ms)", "OCR_TIMEOUT_MS", c.ocrTimeoutMs, 120000),
        entry("tessdata dir", "OCR_TESSDATA_PREFIX", c.ocrTessdataPrefix || "(fast eng)", "(fast eng)"),
      ],
    },
    {
      category: "Embeddings & tags",
      items: [
        entry("CLIP model", "EMBED_MODEL", c.embedModel, "Xenova/clip-vit-base-patch16"),
        entry("Quantization", "EMBED_DTYPE", c.embedDtype, "q8"),
        entry("Dimensions", "EMBED_DIMENSIONS", c.embedDimensions, 512),
        entry("Model cache", "MODEL_CACHE_PATH", c.modelCachePath, "/data/models"),
        entry("Tag scale", "TAG_SCALE", c.tagScale, 50),
        entry("Tag threshold", "TAG_THRESHOLD", c.tagThreshold, 0.05),
        entry("Max tags", "MAX_TAGS", c.maxTags, 6),
      ],
    },
    {
      category: "Scanning & watcher",
      items: [
        entry("Watcher enabled", "WATCH_ENABLED", c.watchEnabled, true),
        entry("Reconcile interval (h)", "SCAN_INTERVAL_HOURS", c.reconcileIntervalHours, 24),
        entry("Worker concurrency", "WORKER_CONCURRENCY", c.workerConcurrency, 2),
        entry("Heartbeat interval (min)", "HEARTBEAT_INTERVAL_MIN", c.heartbeatIntervalMin, 30),
        entry("Image path", "IMAGE_PATH", c.imagePath, "/images"),
      ],
    },
  ];
}

/** Config owned by the API/service process itself (search + infra connections). */
function serviceConfig() {
  const c = config;
  return [
    {
      category: "Search & services",
      items: [
        entry("Default semantic ratio", "DEFAULT_SEMANTIC_RATIO", c.defaultSemanticRatio, 0.5),
        entry("Meili host", "MEILI_HOST_URL", hostOnly(c.meiliHostUrl), "http://rpg-meilisearch:7700"),
        entry("Redis", "REDIS_URL", hostOnly(c.redisUrl), "redis://rpg-redis:6379"),
        entry("API port", "ENRICHMENT_PORT", c.port, 8080),
      ],
    },
  ];
}

module.exports = { workerConfig, serviceConfig, hostOnly };
