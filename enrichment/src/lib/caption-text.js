// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Shared caption extraction from a parsed exifr metadata object. Used by the
 * caption enricher (writes the searchable `caption` field) and the geo enricher
 * (reads the caption to forward-geocode place text when GPS is absent), so the
 * source precedence + value coercion live in exactly one place.
 */

/** Coerce exifr's value (string, or { value } / array for XMP langfields) to a trimmed string. */
function asText(v) {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return asText(v[0]);
  if (typeof v === "object" && v.value) return asText(v.value);
  return "";
}

/**
 * Pick the caption from a parsed exifr metadata object.
 * Precedence: XMP dc:description (richest) > IPTC Caption > IFD0 ImageDescription.
 */
function pickCaption(meta) {
  if (!meta) return "";
  return (
    asText(meta.description) ||
    asText(meta.Caption) ||
    asText(meta["Caption-Abstract"]) ||
    asText(meta.ImageDescription)
  );
}

module.exports = { asText, pickCaption };
