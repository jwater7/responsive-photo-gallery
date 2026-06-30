// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// geonames.forward(): offline forward geocoding of caption place text. Capital-
// ization gates false positives; same-named cities disambiguate by a co-mentioned
// region/country, then population. Run: npm test (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

// GEONAMES_* are read at config load, so point them at fixtures BEFORE requiring.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-geonames-test-"));
const citiesPath = path.join(tmp, "cities.txt");
const admin1Path = path.join(tmp, "admin1.txt");
const countryPath = path.join(tmp, "country.txt");

// cities15000 geoname format: 0 id,1 name,2 asciiname,3 alt,4 lat,5 lng,6 fclass,
// 7 fcode,8 cc,9 cc2,10 admin1,11 admin2,12 admin3,13 admin4,14 population.
const city = (name, lat, lng, cc, admin1, pop) =>
  [1, name, name, "", lat, lng, "P", "PPL", cc, "", admin1, "", "", "", pop].join("\t");

fs.writeFileSync(
  citiesPath,
  [
    city("Paris", 48.8534, 2.3488, "FR", "11", 2138551),
    city("Paris", 33.6609, -95.5555, "US", "TX", 24782),
    city("Boston", 42.3584, -71.0598, "US", "MA", 617594),
    city("Nice", 43.7034, 7.2663, "FR", "93", 338620),
    city("New York City", 40.7143, -74.006, "US", "NY", 8175133),
  ].join("\n")
);
fs.writeFileSync(
  admin1Path,
  ["US.TX\tTexas", "US.MA\tMassachusetts", "US.NY\tNew York", "FR.11\tIle-de-France", "FR.93\tProvence"].join("\n")
);
fs.writeFileSync(countryPath, ["FR\tFRA\t250\tFR\tFrance", "US\tUSA\t840\tUS\tUnited States"].join("\n"));

process.env.GEONAMES_CITIES = citiesPath;
process.env.GEONAMES_ADMIN1 = admin1Path;
process.env.GEONAMES_COUNTRY = countryPath;

const test = require("node:test");
const assert = require("node:assert");
const geonames = require("../src/lib/geonames");

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("matches a capitalized city name in caption text", () => {
  const hit = geonames.forward("Boston, 1985");
  assert.ok(hit);
  assert.strictEqual(hit.city, "Boston");
  assert.strictEqual(hit.region, "Massachusetts");
  assert.strictEqual(hit.country, "United States");
  assert.ok(Math.abs(hit.lat - 42.3584) < 1e-6 && Math.abs(hit.lng - -71.0598) < 1e-6);
});

test("requires capitalization (no match in lowercase prose)", () => {
  assert.strictEqual(geonames.forward("a nice view of the bath"), null);
  // ...but the capitalized city does match.
  assert.strictEqual(geonames.forward("Nice, France").city, "Nice");
});

test("disambiguates same-named cities by co-mentioned region/country", () => {
  assert.ok(Math.abs(geonames.forward("Paris, Texas").lat - 33.6609) < 1e-6); // Paris, TX
  assert.ok(Math.abs(geonames.forward("Paris, France").lat - 48.8534) < 1e-6); // Paris, FR
});

test("falls back to population when nothing else disambiguates", () => {
  assert.ok(Math.abs(geonames.forward("Paris").lat - 48.8534) < 1e-6); // bigger Paris (FR)
});

test("matches a multi-word city name", () => {
  assert.strictEqual(geonames.forward("Holiday in New York City").city, "New York City");
});

test("returns null when no city is named", () => {
  assert.strictEqual(geonames.forward("Grandma's birthday party"), null);
  assert.strictEqual(geonames.forward(""), null);
  assert.strictEqual(geonames.forward(null), null);
});
