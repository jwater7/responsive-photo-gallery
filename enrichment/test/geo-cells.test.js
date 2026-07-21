// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// geo-cells: H3 cell-id derivation + geometry conversion used by the map's
// server-side density. Deterministic (no Meili, no network). Run: npm test.

const os = require("os");
const fs = require("fs");
const path = require("path");

// rpg-config resolves EXCLUDES_FILE from CONFIG_PATH at load — give it a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-geo-cells-test-"));
process.env.CONFIG_PATH = path.join(tmp, "config");
fs.mkdirSync(process.env.CONFIG_PATH, { recursive: true });

const test = require("node:test");
const assert = require("node:assert");
const h3 = require("h3-js");

const cells = require("../src/lib/geo-cells");

test("cellFieldNames matches the configured resolutions", () => {
  assert.deepStrictEqual(
    cells.cellFieldNames(),
    cells.RESOLUTIONS.map((r) => `cell_r${r}`)
  );
});

test("cellFields: one id per resolution, agreeing with h3 directly", () => {
  const lat = 47.29678611111111;
  const lng = -122.28165555555556;
  const out = cells.cellFields(lat, lng);
  assert.deepStrictEqual(Object.keys(out).sort(), cells.cellFieldNames().sort());
  for (const res of cells.RESOLUTIONS) {
    assert.strictEqual(out[`cell_r${res}`], h3.latLngToCell(lat, lng, res));
  }
});

test("cellFields: colocated points share a cell; distant points don't", () => {
  const a = cells.cellFields(47.29678, -122.28165);
  const near = cells.cellFields(47.29680, -122.28167); // a few meters away
  const far = cells.cellFields(40.0, -74.0); // different continent-ish
  const coarse = `cell_r${cells.RESOLUTIONS[0]}`;
  assert.strictEqual(a[coarse], near[coarse], "neighbors share the coarse cell");
  assert.notStrictEqual(a[coarse], far[coarse], "distant points differ");
});

test("cellFields: non-finite coordinate yields no fields", () => {
  assert.deepStrictEqual(cells.cellFields(NaN, 1), {});
  assert.deepStrictEqual(cells.cellFields(1, undefined), {});
});

test("cellCenter is inside the cell's own hexagon-ish neighborhood", () => {
  const id = h3.latLngToCell(47.2967, -122.2816, 6);
  const c = cells.cellCenter(id);
  assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lng));
  // The center re-encodes to the same cell.
  assert.strictEqual(h3.latLngToCell(c.lat, c.lng, 6), id);
});

test("cellHexagon returns boundary vertices as [lat,lng] pairs", () => {
  const id = h3.latLngToCell(47.2967, -122.2816, 6);
  const ring = cells.cellHexagon(id);
  assert.ok(Array.isArray(ring) && ring.length >= 5);
  for (const pt of ring) {
    assert.ok(Array.isArray(pt) && pt.length === 2);
    assert.ok(Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
  }
});
