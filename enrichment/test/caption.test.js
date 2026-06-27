// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// caption enricher's pure picker: source precedence (XMP > IPTC > IFD0) and the
// coercion of exifr's value shapes (string, array, { value }) to a trimmed string.
// Run: npm test  (from enrichment/)

const test = require("node:test");
const assert = require("node:assert");

const { pickCaption, asText } = require("../src/enrichers/caption");

test("XMP dc:description wins over IPTC and IFD0", () => {
  const got = pickCaption({
    description: "from xmp",
    Caption: "from iptc",
    ImageDescription: "from ifd0",
  });
  assert.strictEqual(got, "from xmp");
});

test("falls back to IPTC Caption, then Caption-Abstract, then IFD0", () => {
  assert.strictEqual(pickCaption({ Caption: "iptc", ImageDescription: "ifd0" }), "iptc");
  assert.strictEqual(pickCaption({ "Caption-Abstract": "abstract", ImageDescription: "ifd0" }), "abstract");
  assert.strictEqual(pickCaption({ ImageDescription: "ifd0" }), "ifd0");
});

test("returns empty string when nothing is present", () => {
  assert.strictEqual(pickCaption({}), "");
  assert.strictEqual(pickCaption(null), "");
});

test("coerces exifr value shapes and trims", () => {
  assert.strictEqual(asText("  hi  "), "hi");
  assert.strictEqual(asText(["  first  ", "second"]), "first"); // XMP lang-array
  assert.strictEqual(asText({ value: "wrapped" }), "wrapped"); // XMP langfield object
  assert.strictEqual(asText(""), "");
  assert.strictEqual(asText(undefined), "");
});

test("blank/whitespace-only captions are skipped in precedence", () => {
  // An empty XMP description must not mask a real IPTC caption.
  assert.strictEqual(pickCaption({ description: "   ", Caption: "real" }), "real");
});
