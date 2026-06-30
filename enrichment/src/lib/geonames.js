// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Offline reverse geocoder backed by GeoNames dumps bundled into the image
 * (cities15000 + admin1 + countryInfo). Loads once into memory and resolves
 * coordinates to the nearest city's place hierarchy. No network calls, ever.
 *
 * If the dataset is absent, reverse() returns null and callers fall back to
 * storing raw coordinates only.
 */

const fs = require("fs");
const config = require("./config");

const debug = require("debug")("responsive-photo-gallery:geonames");
const debugErr = require("debug")("responsive-photo-gallery:geonames:error");
debugErr.enabled = true; // errors are always-on, not gated by DEBUG (see bin/server.js)

let cities = null; // [{ lat, lng, name, cc, admin1 }]
let admin1 = null; // Map "US.MA" -> "Massachusetts"
let countries = null; // Map "US" -> "United States"

function loadOnce() {
  if (cities) return;

  cities = [];
  try {
    const data = fs.readFileSync(config.geonamesCitiesPath, "utf8");
    for (const line of data.split("\n")) {
      const c = line.split("\t");
      if (c.length < 11) continue;
      const lat = parseFloat(c[4]);
      const lng = parseFloat(c[5]);
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
      // name (c1), asciiname (c2), cc (c8), admin1 (c10), population (c14) — the
      // last two power forward()'s name index + same-name disambiguation.
      cities.push({
        lat,
        lng,
        name: c[1],
        asciiname: c[2],
        cc: c[8],
        admin1: c[10],
        pop: parseInt(c[14], 10) || 0,
      });
    }
  } catch (err) {
    debugErr("cities load failed (%s): %s", config.geonamesCitiesPath, err.message);
  }

  admin1 = new Map();
  try {
    for (const line of fs.readFileSync(config.geonamesAdmin1Path, "utf8").split("\n")) {
      const c = line.split("\t");
      if (c.length >= 2) admin1.set(c[0], c[1]);
    }
  } catch (_) {
    /* optional */
  }

  countries = new Map();
  try {
    for (const line of fs.readFileSync(config.geonamesCountryPath, "utf8").split("\n")) {
      if (line.startsWith("#")) continue;
      const c = line.split("\t");
      if (c.length >= 5) countries.set(c[0], c[4]);
    }
  } catch (_) {
    /* optional */
  }

  debug("loaded %d cities", cities.length);
}

/**
 * Resolve coordinates to the nearest city. Longitude is scaled by cos(lat) so
 * the nearest-neighbour search is sensible away from the equator.
 *
 * @returns {{city: string, region: string|null, country: string}|null}
 */
function reverse(lat, lng) {
  loadOnce();
  if (!cities.length) return null;

  const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-6;
  let best = null;
  let bestD = Infinity;

  for (const city of cities) {
    if (Math.abs(city.lat - lat) > 5) continue; // cheap prune
    const dLat = city.lat - lat;
    const dLng = (city.lng - lng) * cosLat;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      bestD = d;
      best = city;
    }
  }
  if (!best) return null;

  return {
    city: best.name,
    region: admin1.get(`${best.cc}.${best.admin1}`) || null,
    country: countries.get(best.cc) || best.cc,
  };
}

// --- forward geocoding (place text -> coordinates) --------------------------

// lowercase + strip diacritics + fold punctuation to spaces, so caption text and
// index keys match regardless of accents/punctuation ("Zürich" ~ asciiname
// "Zurich", "Stratford-upon-Avon" ~ "stratford upon avon"). Non-Latin scripts
// fold away (those cities are still indexed via their ASCII asciiname).
function normName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

let nameIndex = null; // Map(normName -> city[])
function buildNameIndex() {
  if (nameIndex) return;
  loadOnce();
  nameIndex = new Map();
  const add = (key, city) => {
    if (!key) return;
    let arr = nameIndex.get(key);
    if (!arr) nameIndex.set(key, (arr = []));
    arr.push(city);
  };
  for (const city of cities) {
    add(normName(city.name), city);
    if (city.asciiname && city.asciiname !== city.name) add(normName(city.asciiname), city);
  }
}

// Lowercase connectors allowed inside a multi-word place name (e.g. "Rio de
// Janeiro", "Isle of Man"); a run still must start and end on a capitalized word.
const CONNECTORS = new Set([
  "de", "del", "la", "le", "les", "of", "the", "do", "dos", "das",
  "van", "von", "der", "den", "el", "y", "upon", "on",
]);

const isCapWord = (w) => /^\p{Lu}/u.test(w);

// Candidate place phrases (1-3 words) from capitalized runs within each
// punctuation-delimited segment. Capitalization is the false-positive guard:
// "a nice view" yields nothing, "Nice, France" yields "nice".
function placePhrases(text) {
  const phrases = new Set();
  for (const seg of String(text).split(/[,.;:!?()/"\n\r]+/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    let run = [];
    const flush = () => {
      while (run.length && CONNECTORS.has(run[run.length - 1].toLowerCase())) run.pop();
      for (let i = 0; i < run.length; i++) {
        for (let n = 1; n <= 3 && i + n <= run.length; n++) {
          phrases.add(normName(run.slice(i, i + n).join(" ")));
        }
      }
      run = [];
    };
    for (const w of words) {
      if (isCapWord(w)) run.push(w);
      else if (run.length && CONNECTORS.has(w.toLowerCase())) run.push(w);
      else flush();
    }
    flush();
  }
  phrases.delete("");
  return phrases;
}

function placeHierarchy(city) {
  return {
    city: city.name,
    region: admin1.get(`${city.cc}.${city.admin1}`) || null,
    country: countries.get(city.cc) || city.cc,
  };
}

/**
 * Forward-geocode free place text (e.g. a photo caption) to a single best city.
 * Capitalization-gated for precision; disambiguates same-named cities by a
 * co-mentioned region/country, then by population. Returns null when nothing
 * confidently matches. Offline; cities15000 only (no small towns/landmarks).
 *
 * @returns {{lat:number, lng:number, city:string, region:string|null, country:string}|null}
 */
function forward(text) {
  if (!text) return null;
  buildNameIndex();
  if (!cities.length) return null;

  const fullNorm = ` ${normName(text)} `;
  const mentioned = (name) => name && fullNorm.includes(` ${normName(name)} `);

  let best = null;
  let bestScore = -Infinity;
  for (const phrase of placePhrases(text)) {
    const matches = nameIndex.get(phrase);
    if (!matches) continue;
    const words = phrase.split(" ").length;
    for (const city of matches) {
      const h = placeHierarchy(city);
      const coMention = mentioned(h.region) || mentioned(h.country);
      // Longer phrase ≫ region/country co-mention ≫ population (tiebreak).
      const score = words * 1000 + (coMention ? 100 : 0) + Math.log10(city.pop + 1);
      if (score > bestScore) {
        bestScore = score;
        best = { lat: city.lat, lng: city.lng, ...h };
      }
    }
  }
  return best;
}

module.exports = { reverse, forward, loadOnce };
