#!/usr/bin/env node
// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * OCR profiling harness. Runs the native engine over a fixture directory under
 * several config combos and reports, per combo, the wall time, kept-word count,
 * mean confidence, and a text snippet — so the time/quality tradeoff of each
 * knob can be measured before enabling it in prod. No running service needed;
 * this calls the engine directly (cf. the search evaluator in eval.js).
 *
 *   node src/bin/ocr-bench.js [--dir=../debug-data/pics] [--limit=20] \
 *                             [--tessdata=/data/tessdata-best]
 */

const fs = require("fs");
const path = require("path");

const config = require("../lib/config");
const native = require("../enrichers/ocr-engines/native");
const { SUPPORTED_FORMAT_REGEXP } = require("../lib/walk-dir");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);

const dir = args.dir || "../debug-data/pics";
const limit = args.limit !== undefined ? Number(args.limit) : 20;
const tessdataBest = args.tessdata || "/data/tessdata-best";

// The combos to sweep. Each is the set of OCR config overrides applied (on top
// of the engine defaults) before running recognize. `skipIf` lets us omit a
// combo that can't run in this environment (e.g. tessdata_best not bundled).
const COMBOS = [
  { name: "baseline", cfg: { ocrMinConfidence: 0, ocrPsm: "", ocrTessdataPrefix: "", ocrPreprocess: false } },
  { name: "+conf>=50", cfg: { ocrMinConfidence: 50, ocrPsm: "", ocrTessdataPrefix: "", ocrPreprocess: false } },
  { name: "+psm11", cfg: { ocrMinConfidence: 50, ocrPsm: "11", ocrTessdataPrefix: "", ocrPreprocess: false } },
  {
    name: "+tessbest",
    cfg: { ocrMinConfidence: 50, ocrPsm: "11", ocrTessdataPrefix: tessdataBest, ocrPreprocess: false },
    skipIf: () => !fs.existsSync(path.join(tessdataBest, `${config.ocrLang}.traineddata`)),
  },
  { name: "+preprocess", cfg: { ocrMinConfidence: 50, ocrPsm: "11", ocrTessdataPrefix: "", ocrPreprocess: true } },
];

/** Shallow-list image files under `root` (recursive), capped at `limit`. */
function listImages(root, cap) {
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length >= cap) return;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (SUPPORTED_FORMAT_REGEXP.test(ent.name)) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Temporarily apply config overrides, run fn, restore. */
async function withConfig(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) saved[k] = config[k];
  Object.assign(config, overrides);
  try {
    return await fn();
  } finally {
    Object.assign(config, saved);
  }
}

function wordCount(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

(async () => {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) {
    console.error(`fixture dir not found: ${root}`);
    process.exit(2);
  }

  const files = listImages(root, limit);
  if (!files.length) {
    console.error(`no images under ${root}`);
    process.exit(2);
  }
  console.log(`Benchmarking ${files.length} image(s) under ${root}\n`);

  for (const combo of COMBOS) {
    if (combo.skipIf && combo.skipIf()) {
      console.log(`${combo.name.padEnd(12)} — skipped (tessdata_best not bundled at ${tessdataBest})`);
      continue;
    }

    let totalMs = 0;
    let totalWords = 0;
    let confSum = 0;
    let confN = 0;
    let sample = "";

    await withConfig(combo.cfg, async () => {
      for (const f of files) {
        const t0 = process.hrtime.bigint();
        const { content, confidence } = await native.recognize(f).catch(() => ({ content: "", confidence: 0 }));
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;

        totalMs += ms;
        totalWords += wordCount(content);
        if (confidence > 0) {
          confSum += confidence;
          confN += 1;
        }
        if (!sample && content) sample = content.replace(/\s+/g, " ").slice(0, 80);
      }
    });

    const avgMs = (totalMs / files.length).toFixed(0);
    const avgConf = confN ? Math.round((confSum / confN) * 100) : 0;
    console.log(
      `${combo.name.padEnd(12)} ${avgMs.padStart(5)}ms/img  ` +
        `${String(totalWords).padStart(5)} words  ${String(avgConf).padStart(3)}% conf  | ${sample}`,
    );
  }
})();
