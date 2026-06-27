// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// Smoke test: the route module must load without throwing. The unit tests
// exercise pure libs and never `require()` the router, so a syntax error there
// (e.g. a stray `*/` closing a swagger JSDoc block early) would otherwise slip
// past `npm test` and only crash the API at boot. This catches it.
// Run: npm test  (from enrichment/)

const test = require("node:test");
const assert = require("node:assert");

test("enrichment-api router module loads (catches route-file syntax errors)", () => {
  let router;
  assert.doesNotThrow(() => {
    router = require("../src/routes/enrichment-api");
  });
  assert.strictEqual(typeof router, "function"); // an express Router
});
