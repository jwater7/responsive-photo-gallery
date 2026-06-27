// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Native OCR engine: shells out to the `tesseract` binary (installed in the
 * container image). Uses TSV output so a single pass yields both text and a
 * per-word confidence. Optional ImageMagick preprocessing (grayscale +
 * normalize) when OCR_PREPROCESS is enabled.
 */

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const config = require("../../lib/config");

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

/**
 * Parse tesseract TSV into reconstructed text + mean word confidence (0-1).
 * Columns: level page block par line word left top width height conf text
 *
 * Words below `minConfidence` (Tesseract's 0-100 scale) are dropped — the
 * biggest noise win on raw photos. Lines left empty after filtering are
 * dropped too, and the mean confidence reflects only the kept words.
 */
function parseTsv(tsv, minConfidence = 0) {
  const rows = tsv.split("\n");
  const lineMap = new Map();
  const order = [];
  const confs = [];

  for (let i = 1; i < rows.length; i++) {
    const c = rows[i].split("\t");
    if (c.length < 12 || c[0] !== "5") continue; // level 5 == word
    const text = c[11];
    if (!text || !text.trim()) continue;

    const conf = parseFloat(c[10]);
    if (conf >= 0 && conf < minConfidence) continue; // drop low-confidence noise

    const key = `${c[1]}-${c[2]}-${c[3]}-${c[4]}`; // page-block-par-line
    if (!lineMap.has(key)) {
      lineMap.set(key, []);
      order.push(key);
    }
    lineMap.get(key).push(text);

    if (conf >= 0) confs.push(conf);
  }

  const content = order.map((k) => lineMap.get(k).join(" ")).join("\n").trim();
  const confidence = confs.length
    ? confs.reduce((a, b) => a + b, 0) / confs.length / 100
    : 0;
  return { content, confidence };
}

/**
 * Compose the ImageMagick args for the OCR preprocess pass. Two independent
 * transforms in one `convert` call:
 *  - downscale (safety): cap the long edge at `maxDim`. `WxH>` shrinks ONLY when
 *    an image is larger (it never enlarges), so already-small images are left
 *    alone; this is what keeps a full-res phone photo from pushing Tesseract
 *    past its resolution cliff.
 *  - quality (opt-in): grayscale + auto-level + contrast-stretch + a mild
 *    sharpen to lift text off busy photo backgrounds. We deliberately avoid a
 *    hard global binarize (`-threshold`) — it destroys text on photo
 *    backgrounds.
 * Either, both, or neither may be enabled; the order keeps grayscale before the
 * tonal ops.
 */
function buildConvertArgs(absPath, tmp, { downscale, quality, maxDim }) {
  const args = [absPath];
  if (quality) args.push("-colorspace", "Gray");
  if (downscale) args.push("-resize", `${maxDim}x${maxDim}>`);
  if (quality) args.push("-auto-level", "-contrast-stretch", "1%x1%", "-sharpen", "0x1");
  args.push(tmp);
  return args;
}

/**
 * Preprocess to a temp PNG for OCR. Caller cleans up. The downscale cap and the
 * quality pass are gated independently by the caller (see recognize).
 */
async function preprocess(absPath, opts) {
  const tmp = path.join(os.tmpdir(), `ocr-${crypto.randomBytes(8).toString("hex")}.png`);
  await execFileP("convert", buildConvertArgs(absPath, tmp, opts));
  return tmp;
}

async function recognize(absPath) {
  let input = absPath;
  let tmp = null;

  // Run the preprocess pass when EITHER the safety downscale (default on) or the
  // quality pass (OCR_PREPROCESS) is enabled.
  if (config.ocrDownscale || config.ocrPreprocess) {
    try {
      tmp = await preprocess(absPath, {
        downscale: config.ocrDownscale,
        quality: config.ocrPreprocess,
        maxDim: config.ocrDownscaleMaxDim,
      });
      input = tmp;
    } catch (_) {
      input = absPath; // fall back to the original on preprocess failure
    }
  }

  // Positional input + stdout first, then optional flags, then the TSV format.
  const args = [input, "stdout", "-l", config.ocrLang];
  if (config.ocrTessdataPrefix) args.push("--tessdata-dir", config.ocrTessdataPrefix);
  if (config.ocrPsm) args.push("--psm", String(config.ocrPsm));
  args.push("tsv");

  // Wall-clock cap: SIGKILL a runaway Tesseract (a file past the resolution
  // cliff — e.g. preprocess fell back to full-res) so it surfaces as an
  // ocr_error and frees the worker slot instead of burning tens of minutes.
  const opts = {};
  if (config.ocrTimeoutMs > 0) {
    opts.timeout = config.ocrTimeoutMs;
    opts.killSignal = "SIGKILL";
  }

  try {
    const tsv = await execFileP("tesseract", args, opts);
    return parseTsv(tsv, config.ocrMinConfidence);
  } finally {
    if (tmp) fs.promises.unlink(tmp).catch(() => {});
  }
}

module.exports = { name: "native", recognize, parseTsv, buildConvertArgs };
