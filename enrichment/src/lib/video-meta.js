// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Video embedded-metadata reader for the geo enricher. Runs `ffprobe` once
 * (added to the enrichment image in enrichment/Dockerfile) and returns the
 * fields the geo branch writes: location, capture date, duration, and stream
 * dimensions.
 *
 * Invoked as a subprocess via child_process — no fluent-ffmpeg dependency. The
 * coordinate may ride one of several container tags (Apple
 * `com.apple.quicktime.location.ISO6709`, generic `location`/`location-eng`, or
 * Matroska `LOCATION`) — see LOCATION_KEYS; the capture date prefers the
 * timezone-aware Apple creation date over the (usually UTC) `creation_time`,
 * mirroring the gallery's renderVideoCell so the map/date grouping and the album
 * view agree on a clip's local year.
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

/** Lower-case all tag keys so lookups are case-insensitive (webm emits LOCATION,
 *  mp4/mov emit location, etc.). */
function lowerKeys(tags) {
  const out = {};
  for (const k of Object.keys(tags || {})) out[k.toLowerCase()] = tags[k];
  return out;
}

// Capture date keys, by precedence: the timezone-aware Apple field first, then
// the plain (usually UTC) creation_time.
const DATE_KEYS = ["com.apple.quicktime.creationdate", "creation_time"];
// GPS keys, by precedence. The coordinate can ride different container tags:
// Apple (iPhone), the generic location/location-eng (ffmpeg/Android mp4/mov), or
// LOCATION (Matroska/webm). All compared lower-cased via lowerKeys().
const LOCATION_KEYS = ["com.apple.quicktime.location.iso6709", "location", "location-eng"];

/**
 * Capture date with precedence: timezone-aware Apple creation date over the
 * plain `creation_time`. Returns a Date, or null when neither is present/valid.
 */
function parseTakenAt(tags) {
  const t = lowerKeys(tags);
  for (const key of DATE_KEYS) {
    const raw = t[key];
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/** First present location tag (across Apple/generic/webm keys), or undefined. */
function pickLocation(tags) {
  const t = lowerKeys(tags);
  for (const key of LOCATION_KEYS) {
    if (t[key]) return t[key];
  }
  return undefined;
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
    gps: parseISO6709(pickLocation(tags)),
    takenAt: parseTakenAt(tags),
    duration: Number.isFinite(durationSec) ? Math.round(durationSec) : null,
    width: vstream && Number.isFinite(vstream.width) ? vstream.width : null,
    height: vstream && Number.isFinite(vstream.height) ? vstream.height : null,
  };
}

module.exports = { videoMeta, parseISO6709, parseTakenAt, pickLocation };
