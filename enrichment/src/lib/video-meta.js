// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Video embedded-metadata reader for the geo enricher. Runs `ffprobe` once
 * (added to the enrichment image in enrichment/Dockerfile) and returns the
 * fields the geo branch writes: location, capture date, duration, and stream
 * dimensions.
 *
 * Invoked as a subprocess via child_process — no fluent-ffmpeg dependency. The
 * coordinate lives in the `com.apple.quicktime.location.ISO6709` container tag;
 * the capture date prefers the timezone-aware Apple creation date over the
 * (usually UTC) `creation_time`, mirroring the gallery's renderVideoCell so the
 * map/date grouping and the album view agree on a clip's local year.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

/**
 * Parse an ISO 6709 location string into decimal-degree { lat, lng }.
 * QuickTime emits e.g. "+47.1187-122.9301+034.945/" (lat, lng, optional
 * altitude). Coordinates always carry an explicit sign, so two consecutive
 * signed decimals are unambiguously latitude then longitude; altitude is ignored.
 * @param {string|undefined} s
 * @returns {{lat: number, lng: number}|null}
 */
function parseISO6709(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Capture date with precedence: timezone-aware Apple creation date over the
 * plain `creation_time`. Returns a Date, or null when neither is present/valid.
 */
function parseTakenAt(tags) {
  for (const key of ["com.apple.quicktime.creationdate", "creation_time"]) {
    const raw = tags[key];
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/** Run ffprobe and return the parsed JSON (throws on probe failure / bad JSON). */
async function probe(absPath) {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", absPath],
    { maxBuffer: 10 * 1024 * 1024 }
  );
  return JSON.parse(stdout);
}

/**
 * Read a video's embedded metadata.
 * @param {string} absPath
 * @returns {Promise<{gps: {lat,lng}|null, takenAt: Date|null, duration: number|null, width: number|null, height: number|null}>}
 * @throws if ffprobe is missing or the file can't be probed (caller records a soft error)
 */
async function videoMeta(absPath) {
  const data = await probe(absPath);
  const format = data.format || {};
  const tags = format.tags || {};
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const vstream = streams.find((s) => s.codec_type === "video") || null;

  const durationSec = parseFloat(format.duration);

  return {
    gps: parseISO6709(tags["com.apple.quicktime.location.ISO6709"]),
    takenAt: parseTakenAt(tags),
    duration: Number.isFinite(durationSec) ? Math.round(durationSec) : null,
    width: vstream && Number.isFinite(vstream.width) ? vstream.width : null,
    height: vstream && Number.isFinite(vstream.height) ? vstream.height : null,
  };
}

module.exports = { videoMeta, parseISO6709, parseTakenAt };
