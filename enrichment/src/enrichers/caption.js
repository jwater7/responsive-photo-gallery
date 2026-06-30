// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Caption enricher — extracts a human-written caption embedded in the file's
 * IPTC/XMP/IFD0 metadata and writes it as a searchable `caption` field. This is
 * curated text (scanned/archival photos often carry it), so it's a much higher-
 * quality signal than OCR or visual labels. Caption is optional: images without
 * one still get the `caption_checked` marker so we don't re-parse them every
 * scan.
 *
 * Output fields:
 *   caption_checked (boolean idempotency marker; always set)
 *   caption         (string)  - first non-empty of XMP dc:description,
 *                               IPTC Caption, or IFD0 ImageDescription
 */

const exifr = require("exifr");

const { SUPPORTED_FORMAT_REGEXP } = require("../lib/walk-dir");
const { asText, pickCaption } = require("../lib/caption-text");

const debugErr = require("debug")("responsive-photo-gallery:caption:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

module.exports = {
  name: "caption",
  version: 1, // bump when output-producing logic changes (forces regen on full scan)
  outputFields: ["caption_checked"],
  applies: (file) => SUPPORTED_FORMAT_REGEXP.test(file.relPath),
  async enrich({ absPath }) {
    const out = { caption_checked: true };

    try {
      const meta = await exifr.parse(absPath, { iptc: true, xmp: true, ifd0: true }).catch(() => null);
      const caption = pickCaption(meta);
      if (caption) out.caption = caption;
    } catch (err) {
      debugErr("caption extraction failed for %s: %s", absPath, err.message);
      // Consumed by the pipeline (→ `caption_error`) to force a retry; a
      // caption-less photo is the no-`caption`-but-no-error case, not retried.
      out.error = err.message;
    }

    return out;
  },
  asText,
  pickCaption,
};
