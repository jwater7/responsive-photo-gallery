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
 *   geo_source  ("exif" image | "quicktime" video | "inferred" caption text) -
 *                                           precedence: manual > exif | quicktime
 *                                           > inferred (forward-geocoded caption)
 *   duration / width / height             - video only
 */

const exifr = require("exifr");

const config = require("../lib/config");
const geonames = require("../lib/geonames");
const { cellFields } = require("../lib/geo-cells");
const { pickCaption } = require("../lib/caption-text");
const { videoMeta } = require("../lib/video-meta");
const { VIDEO_FORMAT_REGEXP, MEDIA_FORMAT_REGEXP } = require("../lib/walk-dir");

const debugErr = require("debug")("responsive-photo-gallery:geo:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

const isVideo = (relPath) => VIDEO_FORMAT_REGEXP.test(relPath);

/** Write the searchable place hierarchy ({ city, region, country }) onto `out`. */
function setPlace(out, place) {
  if (!place) return;
  out.place = [place.city, place.region, place.country].filter(Boolean).join(", ");
  out.place_city = place.city;
  out.place_country = place.country;
}

/** Reverse-geocode coordinates into the searchable place hierarchy (offline). */
function reverseGeocode(out, lat, lng) {
  setPlace(out, geonames.reverse(lat, lng));
}

/**
 * Fallback when an image has no GPS: forward-geocode the embedded caption's place
 * text (offline, cities only) and pin it as the lowest-precedence `inferred`
 * source. Gated by GEO_INFER_FROM_CAPTION; never overrides a real GPS fix.
 */
async function inferFromCaption(out, absPath) {
  if (out._geo || !config.geoInferFromCaption) return;
  const meta = await exifr.parse(absPath, { iptc: true, xmp: true, ifd0: true }).catch(() => null);
  const caption = pickCaption(meta);
  const hit = caption && geonames.forward(caption);
  if (hit) {
    out._geo = { lat: hit.lat, lng: hit.lng };
    out.geo_source = "inferred";
    setPlace(out, hit);
  }
}

/** Image path: EXIF GPS + DateTimeOriginal via exifr; caption inference if no GPS. */
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

  await inferFromCaption(out, absPath);
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
  version: 4, // bump when output-producing logic changes (forces regen on full scan)
  outputFields: ["geo_checked"],
  applies: (file) => MEDIA_FORMAT_REGEXP.test(file.relPath),
  async enrich({ file, absPath, existing }) {
    const out = { geo_checked: true };

    // Never clobber a manually-assigned location — but still (re)derive its H3
    // map-density cells from the existing coordinate, so a backfill/version bump
    // gives manually-pinned docs their cells too.
    if (existing && existing.geo_source === "manual") {
      if (existing._geo) Object.assign(out, cellFields(existing._geo.lat, existing._geo.lng));
      return out;
    }

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

    // Tag the location's H3 cells (all persisted resolutions) whenever we have a
    // coordinate — exif/quicktime or inferred — so the map can count by cell.
    if (out._geo) Object.assign(out, cellFields(out._geo.lat, out._geo.lng));

    return out;
  },
};
