// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Decoder capability of THIS build, probed once at module load.
 *
 * "Supported extension" (the registry) and "decodable here" are distinct:
 * sharp's image coverage depends on how its bundled libvips was built (HEIF /
 * AVIF only when compiled in; BMP never), and both pixel-decoding stages ride
 * on sharp — OCR preprocesses through it directly, and the visual embedder's
 * transformers.js RawImage.read uses it under the hood. Pixel-decoding
 * enrichers gate on this and soft-fail undecodable files WITHOUT attempting a
 * decode (cheap, and the recorded `<stage>_error` means a later HEIF-capable
 * build heals them on re-scan). Metadata-only enrichers (geo, caption — exifr)
 * take every registry image format and must NOT use this gate.
 */

const path = require("path");
const sharp = require("sharp");
const { decodableImageExts } = require("rpg-media-types");

const DECODABLE_IMAGE_EXTS = decodableImageExts(sharp.format);

const isDecodableImage = (p) =>
  DECODABLE_IMAGE_EXTS.has(path.extname(p).toLowerCase());

/**
 * The stable soft-error a pixel-decoding enricher returns for a format this
 * build can't decode. One shape everywhere so the admin failed-stage stats
 * group these together, clearly distinct from real decode/engine failures.
 */
const undecodableError = (p) =>
  `undecodable: no ${path.extname(p).toLowerCase()} decoder in this sharp build`;

module.exports = { DECODABLE_IMAGE_EXTS, isDecodableImage, undecodableError };
