// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// walk-dir excludes: top-level prefix, nested prefix, partial-name non-match, and
// the fail-open behavior on a missing/garbage excludes.json (walk everything).
// Run: npm test  (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

// Hermetic CONFIG_PATH (read at rpg-config module load -> EXCLUDES_FILE).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-walk-dir-test-"));
const CONFIG_PATH = path.join(tmp, "config");
fs.mkdirSync(CONFIG_PATH, { recursive: true });
process.env.CONFIG_PATH = CONFIG_PATH;

const test = require("node:test");
const assert = require("node:assert");

const walkDir = require("../src/lib/walk-dir");
const { EXCLUDES_FILE } = require("rpg-config");

// Build a small image tree.
const base = path.join(tmp, "images");
const files = [
  "keep/a.jpg",
  "private/b.jpg",
  "work/c.jpg",
  "work/scans/d.jpg",
  "workshop/e.jpg",
];
for (const rel of files) {
  const abs = path.join(base, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "x");
}

const relPaths = (excludes) =>
  walkDir(base, "", [], excludes)
    .map((f) => f.relPath)
    .sort();

test("top-level prefix exclude hides the whole subtree", () => {
  const got = relPaths(["private"]);
  assert.ok(!got.some((p) => p === "private" || p.startsWith("private/")));
  assert.ok(got.includes("keep/a.jpg"));
});

test("nested prefix exclude hides only the subtree", () => {
  const got = relPaths(["work/scans"]);
  assert.ok(got.includes("work/c.jpg")); // sibling still walked
  assert.ok(!got.includes("work/scans/d.jpg")); // nested excluded
});

test("partial-name is NOT a match (work must not exclude workshop)", () => {
  const got = relPaths(["work"]);
  assert.ok(!got.some((p) => p.startsWith("work/")));
  assert.ok(got.includes("workshop/e.jpg")); // distinct top-level kept
});

test("missing excludes.json => walk everything (fail-open)", () => {
  fs.rmSync(EXCLUDES_FILE, { force: true });
  const got = walkDir(base).map((f) => f.relPath); // loads from file (none)
  assert.strictEqual(got.length, files.length);
});

test("garbage excludes.json => walk everything (fail-open)", () => {
  fs.writeFileSync(EXCLUDES_FILE, "{ not json");
  const got = walkDir(base).map((f) => f.relPath);
  assert.strictEqual(got.length, files.length);
});

test("valid excludes.json on disk is honored by a top-level walk", () => {
  fs.writeFileSync(EXCLUDES_FILE, JSON.stringify({ excludes: ["private"] }));
  const got = walkDir(base).map((f) => f.relPath);
  assert.ok(!got.some((p) => p.startsWith("private")));
  assert.strictEqual(got.length, files.length - 1);
});
