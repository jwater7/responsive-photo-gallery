// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Geo enricher — the embedded-metadata stage. Extracts location + capture time
 * from a file's own metadata, reverse-geocodes the coordinates offline, and
 * writes location fields. Location is optional: files without GPS still get the
 * `geo_checked` marker (so we don't re-parse them every scan) but no `_geo`.
 *
 * Handles both images and videos (this stage is the only one that opts into
 * video — see walk-dir.js; the image-only enrichers skip it by construction):
 *   - image → exifr (EXIF GPS + DateTimeOriginal)
 *   - video → ffprobe via video-meta.js (QuickTime location + creation date,
 *             plus duration/width/height from the same probe)
 *
 * Output fields:
 *   geo_checked (boolean idempotency marker; always set)
 *   _geo        ({ lat, lng })            - when GPS is present
 *   place / place_city / place_country    - reverse-geocoded text (searchable)
 *   taken_at    (ISO 8601)                - capture date
 *   geo_source  ("exif" image | "quicktime" video) - precedence:
 *                                           manual > exif | quicktime > inferred
 *   duration / width / height             - video only
 */

const exifr = require("exifr");

const geonames = require("../lib/geonames");
const { videoMeta } = require("../lib/video-meta");
const { VIDEO_FORMAT_REGEXP, MEDIA_FORMAT_REGEXP } = require("../lib/walk-dir");

const debugErr = require("debug")("responsive-photo-gallery:geo:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

const isVideo = (relPath) => VIDEO_FORMAT_REGEXP.test(relPath);

/** Reverse-geocode coordinates into the searchable place hierarchy (offline). */
function reverseGeocode(out, lat, lng) {
  const place = geonames.reverse(lat, lng);
  if (place) {
    out.place = [place.city, place.region, place.country].filter(Boolean).join(", ");
    out.place_city = place.city;
    out.place_country = place.country;
  }
}

/** Image path: EXIF GPS + DateTimeOriginal via exifr. */
async function enrichImage(out, absPath) {
  const gps = await exifr.gps(absPath).catch(() => null);
  if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
    out._geo = { lat: gps.latitude, lng: gps.longitude };
    out.geo_source = "exif";
    reverseGeocode(out, gps.latitude, gps.longitude);
  }

  const meta = await exifr.parse(absPath, ["DateTimeOriginal"]).catch(() => null);
  if (meta && meta.DateTimeOriginal) {
    out.taken_at = new Date(meta.DateTimeOriginal).toISOString();
  }
}

/** Video path: QuickTime location + creation date + duration/dims via ffprobe. */
async function enrichVideo(out, absPath) {
  const meta = await videoMeta(absPath); // throws on probe failure → caught below → retry
  if (meta.gps) {
    out._geo = { lat: meta.gps.lat, lng: meta.gps.lng };
    out.geo_source = "quicktime";
    reverseGeocode(out, meta.gps.lat, meta.gps.lng);
  }
  if (meta.takenAt) out.taken_at = meta.takenAt.toISOString();
  if (meta.duration != null) out.duration = meta.duration;
  if (meta.width != null) out.width = meta.width;
  if (meta.height != null) out.height = meta.height;
}

module.exports = {
  name: "geo",
  version: 1, // bump when output-producing logic changes (forces regen on full scan)
  outputFields: ["geo_checked"],
  applies: (file) => MEDIA_FORMAT_REGEXP.test(file.relPath),
  async enrich({ file, absPath, existing }) {
    const out = { geo_checked: true };

    // Never clobber a manually-assigned location.
    if (existing && existing.geo_source === "manual") return out;

    try {
      if (isVideo(file.relPath)) {
        await enrichVideo(out, absPath);
      } else {
        await enrichImage(out, absPath);
      }
    } catch (err) {
      debugErr("geo extraction failed for %s: %s", absPath, err.message);
      // Consumed by the pipeline (→ `geo_error`) to force a retry; a GPS-less
      // file is the no-`_geo`-but-no-error case and is not retried.
      out.error = err.message;
    }

    return out;
  },
};
