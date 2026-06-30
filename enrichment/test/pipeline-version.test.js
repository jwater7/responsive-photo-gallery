// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// pipeline.isCurrent: the version-aware skip decision. An enricher is skipped
// only when its output fields are present AND the doc's stored version is at
// least the enricher's current version. A missing stamp reads as baseline v1,
// so pre-versioning docs are regenerated only for enrichers bumped past 1.
// Run: npm test  (from enrichment/)

const test = require("node:test");
const assert = require("node:assert");

const { isCurrent, isForced } = require("../src/lib/pipeline");

const ocr = { name: "ocr", version: 2, outputFields: ["content", "confidence"] };
const geo = { name: "geo", version: 1, outputFields: ["geo_checked"] };

test("missing doc is never current (new file runs every enricher)", () => {
  assert.strictEqual(isCurrent(null, ocr), false);
  assert.strictEqual(isCurrent(undefined, geo), false);
});

test("missing output field is never current (backfill)", () => {
  assert.strictEqual(isCurrent({ content: "hi" }, ocr), false); // no confidence
  assert.strictEqual(isCurrent({}, geo), false);
});

test("empty-but-present output still counts as present (not null/undefined)", () => {
  // content:"" is the OCR'd-to-nothing case: present, so only the version gates it.
  assert.strictEqual(isCurrent({ content: "", confidence: 0, ocr_version: 2 }, ocr), true);
});

test("missing version stamp reads as baseline v1 → stale when current > 1", () => {
  // Pre-versioning doc: has OCR output but no ocr_version. OCR is v2 → regenerate.
  assert.strictEqual(isCurrent({ content: "x", confidence: 80 }, ocr), false);
  // ...but geo is still v1, so the same untagged doc is left alone.
  assert.strictEqual(isCurrent({ geo_checked: true }, geo), true);
});

test("stored version >= current is skipped; older is regenerated", () => {
  assert.strictEqual(isCurrent({ content: "x", confidence: 80, ocr_version: 2 }, ocr), true);
  assert.strictEqual(isCurrent({ content: "x", confidence: 80, ocr_version: 3 }, ocr), true); // newer, future-proof
  assert.strictEqual(isCurrent({ content: "x", confidence: 80, ocr_version: 1 }, ocr), false);
});

test("enricher without an explicit version defaults to 1", () => {
  const noVer = { name: "x", outputFields: ["x_checked"] };
  assert.strictEqual(isCurrent({ x_checked: true }, noVer), true);
  assert.strictEqual(isCurrent({ x_checked: true, x_version: 1 }, noVer), true);
});

test("a recorded error forces a retry even when version is current", () => {
  // geo failed last run: geo_checked present, geo_version current, but geo_error set.
  assert.strictEqual(
    isCurrent({ geo_checked: true, geo_version: 1, geo_error: "exifr blew up" }, geo),
    false
  );
  // ...and once the error is cleared (null), the same doc is current again.
  assert.strictEqual(isCurrent({ geo_checked: true, geo_version: 1, geo_error: null }, geo), true);
});

// isForced: the admin "Force" scan re-runs an enricher regardless of isCurrent.
// `true` forces all; a list forces only those names; falsy/[] forces none.
test("isForced: true forces every enricher", () => {
  assert.strictEqual(isForced(true, ocr), true);
  assert.strictEqual(isForced(true, geo), true);
});

test("isForced: a name list forces only the listed enrichers", () => {
  assert.strictEqual(isForced(["ocr"], ocr), true);
  assert.strictEqual(isForced(["ocr"], geo), false);
  assert.strictEqual(isForced(["geo", "ocr"], geo), true);
});

test("isForced: falsy or empty forces nothing", () => {
  assert.strictEqual(isForced(false, ocr), false);
  assert.strictEqual(isForced(undefined, ocr), false);
  assert.strictEqual(isForced([], ocr), false);
});
