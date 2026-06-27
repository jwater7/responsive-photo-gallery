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
      cities.push({ lat, lng, name: c[1], cc: c[8], admin1: c[10] });
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

module.exports = { reverse, loadOnce };
