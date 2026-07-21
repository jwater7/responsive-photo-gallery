// vim: tabstop=2 shiftwidth=2 expandtab
//
// Optional shared-secret gate for the enrichment API (defense-in-depth on
// :8080). The gallery auto-generates a secret and persists it in the shared
// CONFIG_PATH store; this service mounts that store read-only and verifies the
// secret on every /api/v1 request via the X-Enrich-Secret header.
//
// FAIL-OPEN by design: if no secret is configured (fresh deploy, or the config
// store isn't mounted yet), the gate is a passthrough. This is a second layer
// behind network isolation + the authenticated gallery proxy, NOT the primary
// control — so it never fails closed against its own absence. The secret is read
// fresh per request (rpg-config's raw fail-open reader), so the gallery's
// first write is picked up without restarting this service.

"use strict";

const crypto = require("crypto");
const runtimeConfig = require("rpg-config");

// Constant-time compare; length-guarded (timingSafeEqual throws on length diff).
function timingEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = function requireSharedSecret(req, res, next) {
  const expected = runtimeConfig.loadEnrichSecret(); // fresh, fail-open to null
  if (!expected) return next(); // optional: no secret configured -> open
  const got = req.get("x-enrich-secret");
  if (got && timingEqual(got, expected)) return next();
  return res
    .status(401)
    .json({ error: { code: 401, message: "unauthorized" } });
};
