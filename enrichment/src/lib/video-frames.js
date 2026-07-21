// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Keyframe extraction for the video branches of the visual and ocr enrichers.
 * Probes a clip's duration (via video-meta.js, one ffprobe) and extracts N
 * frames as PNG buffers straight off ffmpeg's stdout — no intermediate files
 * (the OCR engine's path-based interface writes its own temp copy; see
 * enrichers/ocr.js).
 *
 * Sample points are spread evenly across the middle 60% of the clip
 * (20% → 80%): the edges are skipped because intros/outros and fade-to-black
 * frames are the least representative content (see config.videoFrameCount).
 *
 * Frames are scaled (never upscaled) to OCR_DOWNSCALE_MAX on the long edge:
 * the frames feed both OCR and CLIP, OCR's safety cap defines the maximum
 * useful long edge (anything larger would be thrown away by its downscale
 * pass), and CLIP's processor resizes to its own input size regardless — so
 * one extraction at that ceiling serves both consumers losslessly.
 *
 * Every subprocess sets a hard timeout with SIGKILL (a corrupt/truncated
 * container wedging ffmpeg forever is the known failure mode); failures throw
 * so the calling stage soft-fails (`<stage>_error`) and retries on a later
 * scan.
 *
 * The most recent extraction is memoized by absPath: the pipeline runs a
 * file's stages sequentially (ocr → visual), so a single entry lets both
 * stages share one ffmpeg pass with no cache policy or invalidation surface.
 * Rejections are never memoized (same clear-on-failure contract as
 * embedder.load).
 */

const { execFile } = require("child_process");
const { promisify } = require("util");

const config = require("./config");
const { videoMeta } = require("./video-meta");

const execFileAsync = promisify(execFile);

/**
 * Sample timestamps (seconds) for `count` frames of a `duration`-second clip:
 * evenly spaced from 20% to 80% (a single frame lands at the midpoint).
 * Timestamps are deduplicated after rounding, so a very short clip yields
 * fewer, distinct frames rather than identical ones.
 * @param {number} duration seconds (must be finite and > 0)
 * @param {number} count requested frame count (>= 1)
 * @returns {number[]}
 */
function sampleTimes(duration, count) {
  const n = Math.max(1, count);
  const times = [];
  for (let i = 0; i < n; i++) {
    const frac = n === 1 ? 0.5 : 0.2 + (i * 0.6) / (n - 1);
    times.push(frac * duration);
  }
  const seen = new Set();
  return times
    .map((t) => Math.round(t * 100) / 100)
    .filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
}

/** Extract one frame at `time` seconds as a PNG buffer (throws on failure). */
async function extractFrame(absPath, time) {
  // -ss before -i: keyframe-accurate fast seek (decodes one GOP, not the whole
  // clip). min(iw,…) prevents upscaling clips smaller than the target edge.
  const edge = config.ocrDownscaleMaxDim;
  const args = [
    "-v", "error",
    "-ss", String(time),
    "-i", absPath,
    "-frames:v", "1",
    "-vf", `scale=w='min(iw,${edge})':h='min(ih,${edge})':force_original_aspect_ratio=decrease`,
    "-f", "image2pipe",
    "-c:v", "png",
    "-",
  ];
  let stdout;
  try {
    ({ stdout } = await execFileAsync("ffmpeg", args, {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      timeout: config.videoSubprocessTimeoutMs || undefined,
      killSignal: "SIGKILL",
    }));
  } catch (err) {
    const reason = (err.stderr || "").toString().trim();
    if (reason) err.message += `: ${reason}`;
    throw err;
  }
  // ffmpeg exits 0 with empty output when the seek lands past the end (e.g. a
  // stale/lying duration) — surface that as a failure, not an empty frame.
  if (!stdout || stdout.length === 0) {
    throw new Error(`no frame decoded at ${time}s from ${absPath}`);
  }
  return stdout;
}

async function extractAll(absPath) {
  const meta = await videoMeta(absPath); // throws on probe failure
  if (!Number.isFinite(meta.duration) || meta.duration <= 0) {
    throw new Error(`no usable duration for ${absPath}`);
  }
  const frames = [];
  for (const t of sampleTimes(meta.duration, config.videoFrameCount)) {
    frames.push(await extractFrame(absPath, t));
  }
  return frames;
}

// Single-entry memo (see module doc). Keyed by absPath; cleared on rejection.
let last = null; // { absPath, promise }

/**
 * Keyframes of a video as PNG buffers. Consecutive calls for the same path
 * (the ocr and visual stages of one pipeline pass) share one extraction.
 * @param {string} absPath
 * @returns {Promise<Buffer[]>}
 */
function keyframes(absPath) {
  if (last && last.absPath === absPath) return last.promise;
  const promise = extractAll(absPath);
  last = { absPath, promise };
  promise.catch(() => {
    if (last && last.promise === promise) last = null;
  });
  return promise;
}

module.exports = { keyframes, sampleTimes };
