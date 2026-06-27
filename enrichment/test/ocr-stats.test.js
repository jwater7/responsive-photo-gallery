// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// ocr-stats.summarize: content yield (text vs empty), confidence/length stats,
// version-stamp tally, and failure list — the pure aggregation behind the admin
// "OCR detail" panel. Run: npm test  (from enrichment/)

const test = require("node:test");
const assert = require("node:assert");

const { summarize } = require("../src/lib/ocr-stats");
const meili = require("../src/lib/meili");

test("compute()'s meili contract: allDocs is exported (guards a silent 503)", () => {
  // compute() calls meili.allDocs(); summarize tests alone can't catch a missing
  // export, which surfaces only as a runtime 503. Assert the contract directly.
  assert.strictEqual(typeof meili.allDocs, "function");
});

const docs = [
  { path: "a/1.jpg", content: "hello world", confidence: 0.95, ocr_version: 2 },
  { path: "a/2.jpg", content: "  ", confidence: 0, ocr_version: 2 }, // whitespace = empty
  { path: "a/3.jpg", content: "", confidence: 0, ocr_version: 2 },
  { path: "b/4.jpg", content: "low conf text", confidence: 0.4, ocr_version: 2 },
  { path: "b/5.jpg", content: "", confidence: 0, ocr_version: 1, ocr_error: "tesseract crashed" },
  { path: "b/6.jpg", content: "older", confidence: 0.8 }, // unstamped version
];

test("counts content yield, empties (incl. whitespace-only), and failures", () => {
  const s = summarize(docs);
  assert.strictEqual(s.totalDocs, 6);
  assert.strictEqual(s.withText, 3); // 1, 4, 6
  assert.strictEqual(s.empty, 3); //   2 (whitespace), 3, 5
  assert.strictEqual(s.withError, 1);
  assert.deepStrictEqual(s.errors, [{ path: "b/5.jpg", error: "tesseract crashed" }]);
});

test("tallies version stamps including unstamped docs", () => {
  const s = summarize(docs);
  assert.deepStrictEqual(s.versions, { 2: 4, 1: 1, unstamped: 1 });
});

test("confidence + length stats are over docs WITH text only", () => {
  const s = summarize(docs);
  // confidences of text docs: 0.95, 0.4, 0.8
  assert.ok(Math.abs(s.confidence.mean - (0.95 + 0.4 + 0.8) / 3) < 1e-9);
  // buckets on the 0-1 scale: 0.4 -> lt50, 0.8 -> c70_84, 0.95 -> c85_100
  assert.deepStrictEqual(s.confidence.buckets, { lt50: 1, c50_69: 0, c70_84: 1, c85_100: 1 });
  assert.strictEqual(s.contentLength.max, "low conf text".length); // longest text doc (13)
});

test("no-text index yields null distributions, not a crash", () => {
  const s = summarize([{ path: "x/1.jpg", content: "", confidence: 0 }]);
  assert.strictEqual(s.withText, 0);
  assert.strictEqual(s.confidence, null);
  assert.strictEqual(s.contentLength, null);
});

test("empty index", () => {
  const s = summarize([]);
  assert.strictEqual(s.totalDocs, 0);
  assert.strictEqual(s.withText, 0);
  assert.deepStrictEqual(s.versions, {});
});
