// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// parseTsv confidence filtering: sub-threshold words are dropped, lines left
// empty are dropped, and the reported confidence reflects only kept words.
// Run: npm test  (from enrichment/)

const test = require("node:test");
const assert = require("node:assert");

const {
  parseTsv,
  buildConvertArgs,
  buildSharpPipeline,
  resolveBackend,
} = require("../src/enrichers/ocr-engines/native");

// Chainable stub recording [method, ...args] for each sharp op, returning itself
// so a pipeline can be built without decoding a real image.
function recorder() {
  const calls = [];
  const stub = new Proxy(
    {},
    { get: (_t, prop) => (...args) => (calls.push([prop, ...args]), stub) },
  );
  return { stub, calls };
}

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

// buildSharpPipeline: the sharp backend mirrors buildConvertArgs op-for-op and
// order (grayscale -> bounded downscale -> tonal). The resize maps IM's `WxH>`
// shrink-only to fit:'inside' + withoutEnlargement.
const RESIZE_OPTS = { fit: "inside", withoutEnlargement: true };

test("sharp downscale-only resizes within bounds, no quality ops", () => {
  const { stub, calls } = recorder();
  buildSharpPipeline(stub, { downscale: true, quality: false, maxDim: 1500 });
  assert.deepStrictEqual(calls, [["resize", 1500, 1500, RESIZE_OPTS]]);
});

test("sharp quality-only applies grayscale/normalize/sharpen, no resize", () => {
  const { stub, calls } = recorder();
  buildSharpPipeline(stub, { downscale: false, quality: true, maxDim: 1500 });
  assert.deepStrictEqual(
    calls.map((c) => c[0]),
    ["grayscale", "normalize", "sharpen"],
  );
});

test("sharp both: grayscale precedes the resize cap, maxDim honored", () => {
  const { stub, calls } = recorder();
  buildSharpPipeline(stub, { downscale: true, quality: true, maxDim: 2000 });
  const ops = calls.map((c) => c[0]);
  assert.ok(ops.indexOf("grayscale") < ops.indexOf("resize"));
  assert.deepStrictEqual(calls.find((c) => c[0] === "resize"), [
    "resize",
    2000,
    2000,
    RESIZE_OPTS,
  ]);
});

test("sharp neither: a passthrough (no ops)", () => {
  const { stub, calls } = recorder();
  buildSharpPipeline(stub, { downscale: false, quality: false, maxDim: 1500 });
  assert.deepStrictEqual(calls, []);
});

// resolveBackend: sharp is the default; ImageMagick only when opted in AND
// installed (else fall back to sharp so the safety downscale survives).
test("resolveBackend truth table", () => {
  assert.strictEqual(resolveBackend(false, false), "sharp");
  assert.strictEqual(resolveBackend(false, true), "sharp");
  assert.strictEqual(resolveBackend(true, false), "sharp");
  assert.strictEqual(resolveBackend(true, true), "magick");
});

test("downscale is on by default, preprocess off, magick opt-in off", () => {
  delete require.cache[require.resolve("../src/lib/config")];
  const fresh = require("../src/lib/config");
  assert.strictEqual(fresh.ocrDownscale, true);
  assert.strictEqual(fresh.ocrPreprocess, false);
  assert.strictEqual(fresh.ocrDownscaleMaxDim, 1500);
  assert.strictEqual(fresh.ocrPreprocessUseMagick, false);
});
