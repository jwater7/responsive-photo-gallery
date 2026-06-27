// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Geo enricher — extracts EXIF GPS + capture time, reverse-geocodes the
 * coordinates offline, and writes location fields. Location is optional: images
 * without GPS still get the `geo_checked` marker (so we don't re-parse them
 * every scan) but no `_geo`.
 *
 * Output fields:
 *   geo_checked (boolean idempotency marker; always set)
 *   _geo        ({ lat, lng })            - when GPS is present
 *   place / place_city / place_country    - reverse-geocoded text (searchable)
 *   taken_at    (ISO 8601)                - EXIF DateTimeOriginal
 *   geo_source  ("exif")                  - precedence: manual > exif > inferred
 */

const exifr = require("exifr");

const geonames = require("../lib/geonames");
const { SUPPORTED_FORMAT_REGEXP } = require("../lib/walk-dir");

const debugErr = require("debug")("responsive-photo-gallery:geo:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

module.exports = {
  name: "geo",
  version: 1, // bump when output-producing logic changes (forces regen on full scan)
  outputFields: ["geo_checked"],
  applies: (file) => SUPPORTED_FORMAT_REGEXP.test(file.relPath),
  async enrich({ absPath, existing }) {
    const out = { geo_checked: true };

    // Never clobber a manually-assigned location.
    if (existing && existing.geo_source === "manual") return out;

    try {
      const gps = await exifr.gps(absPath).catch(() => null);
      if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
        out._geo = { lat: gps.latitude, lng: gps.longitude };
        out.geo_source = "exif";

        const place = geonames.reverse(gps.latitude, gps.longitude);
        if (place) {
          out.place = [place.city, place.region, place.country].filter(Boolean).join(", ");
          out.place_city = place.city;
          out.place_country = place.country;
        }
      }

      const meta = await exifr.parse(absPath, ["DateTimeOriginal"]).catch(() => null);
      if (meta && meta.DateTimeOriginal) {
        out.taken_at = new Date(meta.DateTimeOriginal).toISOString();
      }
    } catch (err) {
      debugErr("geo extraction failed for %s: %s", absPath, err.message);
      // Consumed by the pipeline (→ `geo_error`) to force a retry; a GPS-less
      // photo is the no-`_geo`-but-no-error case and is not retried.
      out.error = err.message;
    }

    return out;
  },
};
