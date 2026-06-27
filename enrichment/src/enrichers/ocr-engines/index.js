// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * OCR engine selector. An engine exposes `{ name, recognize(absPath) ->
 * { content, confidence } }`. Select with OCR_ENGINE (default: native).
 */

const config = require("../../lib/config");
const native = require("./native");

const engines = { native };

module.exports = engines[config.ocrEngine] || native;
