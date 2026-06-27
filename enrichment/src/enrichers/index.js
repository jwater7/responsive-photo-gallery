// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Ordered list of enrichers. Each must expose:
 *   { name, version?, outputFields: string[], applies(file)?, enrich(ctx) -> fields, terminate()? }
 *
 * `version` (default 1) is an integer bumped when the enricher's output-producing
 * logic changes; the pipeline stamps it as `<name>_version` and regenerates docs
 * whose stored version is older on the next full scan. See lib/pipeline.js.
 */

const ocr = require("./ocr");
const visual = require("./visual");
const geo = require("./geo");
const caption = require("./caption");

module.exports = [ocr, visual, geo, caption];
