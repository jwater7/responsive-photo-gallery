// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// parseTsv confidence filtering: sub-threshold words are dropped, lines left
// empty are dropped, and the reported confidence reflects only kept words.
// Run: npm test  (from enrichment/)

const test = require("node:test");
const assert = require("node:assert");

const { parseTsv, buildConvertArgs } = require("../src/enrichers/ocr-engines/native");

// Tesseract TSV: level page block par line word left top width height conf text.
// Level 5 == word. Header row is skipped (parseTsv starts at row 1).
function tsv(words) {
  const header = "level\tpage\tblock\tpar\tline\tword\tleft\ttop\twidth\theight\tconf\ttext";
  const rows = words.map(
    ([conf, text, line = 1]) => `5\t1\t1\t1\t${line}\t1\t0\t0\t10\t10\t${conf}\t${text}`,
  );
  return [header, ...rows].join("\n");
}

test("keeps every word when minConfidence is 0 (default)", () => {
  const { content, confidence } = parseTsv(tsv([[90, "Hello"], [10, "garblexz"]]));
  assert.strictEqual(content, "Hello garblexz");
  assert.ok(Math.abs(confidence - 0.5) < 1e-9); // mean of 90 and 10, /100
});

test("drops words below the confidence floor", () => {
  const { content, confidence } = parseTsv(tsv([[90, "Hello"], [10, "garblexz"]]), 50);
  assert.strictEqual(content, "Hello");
  assert.ok(Math.abs(confidence - 0.9) < 1e-9); // only the kept word counts
});

test("drops a line that becomes empty after filtering", () => {
  // Line 1 has a good word; line 2 only has noise -> line 2 disappears entirely.
  const { content } = parseTsv(tsv([[80, "Keep", 1], [5, "noise", 2]]), 50);
  assert.strictEqual(content, "Keep");
  assert.ok(!content.includes("\n"));
});

test("empty result when everything is below the floor", () => {
  const { content, confidence } = parseTsv(tsv([[5, "a"], [9, "b"]]), 50);
  assert.strictEqual(content, "");
  assert.strictEqual(confidence, 0);
});

// buildConvertArgs: the downscale safety cap and the quality pass are gated
// independently. The cap is the speed-critical bit — `WxH>` shrinks only when
// larger, so it bounds Tesseract's input regardless of the quality flag.
test("downscale-only adds the resize cap, no quality ops", () => {
  const args = buildConvertArgs("in.jpg", "out.png", { downscale: true, quality: false, maxDim: 1500 });
  assert.deepStrictEqual(args, ["in.jpg", "-resize", "1500x1500>", "out.png"]);
});

test("quality-only adds grayscale/contrast/sharpen, no resize", () => {
  const args = buildConvertArgs("in.jpg", "out.png", { downscale: false, quality: true, maxDim: 1500 });
  assert.ok(args.includes("-colorspace") && args.includes("Gray"));
  assert.ok(args.includes("-sharpen"));
  assert.ok(!args.includes("-resize"));
});

test("both: grayscale precedes the resize cap", () => {
  const args = buildConvertArgs("in.jpg", "out.png", { downscale: true, quality: true, maxDim: 2000 });
  assert.ok(args.indexOf("-colorspace") < args.indexOf("-resize"));
  assert.ok(args.includes("2000x2000>"));
});

test("neither: a passthrough copy (no transforms)", () => {
  const args = buildConvertArgs("in.jpg", "out.png", { downscale: false, quality: false, maxDim: 1500 });
  assert.deepStrictEqual(args, ["in.jpg", "out.png"]);
});

test("downscale is on by default, preprocess off", () => {
  delete require.cache[require.resolve("../src/lib/config")];
  const fresh = require("../src/lib/config");
  assert.strictEqual(fresh.ocrDownscale, true);
  assert.strictEqual(fresh.ocrPreprocess, false);
  assert.strictEqual(fresh.ocrDownscaleMaxDim, 1500);
});
