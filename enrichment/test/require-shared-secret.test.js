// vim: tabstop=2 shiftwidth=2 expandtab
//
// The optional shared-secret gate on the enrichment API. Proves the fail-open
// posture (no secret configured -> passthrough) and the enforced posture
// (secret configured -> only the matching X-Enrich-Secret header is let through).
// Run: npm test (from enrichment/)

"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");

// CONFIG_PATH is read at rpg-config module load, so set it BEFORE requiring the
// middleware (which requires rpg-config). The gate reads the secret file fresh
// each call, so we can create/rewrite it between assertions in one process.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-enrich-secret-test-"));
process.env.CONFIG_PATH = tmp;

const test = require("node:test");
const assert = require("node:assert");

const rc = require("rpg-config");
const requireSharedSecret = require("../src/lib/require-shared-secret");

const SECRET_FILE = path.join(tmp, "enrich-secret.json");
const writeSecret = (s) =>
  fs.writeFileSync(SECRET_FILE, JSON.stringify({ secret: s }));
const clearSecret = () => fs.rmSync(SECRET_FILE, { force: true });

// Minimal Express-ish req/res. req.get is case-insensitive like Express.
function mkReq(headers = {}) {
  const lower = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
  return { get: (h) => lower[h.toLowerCase()] };
}
function mkRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(o) {
      this.body = o;
      return this;
    },
  };
}
function run(headers) {
  const res = mkRes();
  let nexted = false;
  requireSharedSecret(mkReq(headers), res, () => {
    nexted = true;
  });
  return { res, nexted };
}

test("sanity: rpg-config reads the test CONFIG_PATH", () => {
  assert.strictEqual(rc.ENRICH_SECRET_FILE, SECRET_FILE);
});

test("no secret configured -> passthrough (fail-open)", () => {
  clearSecret();
  const { nexted, res } = run({ "x-enrich-secret": "anything" });
  assert.strictEqual(nexted, true);
  assert.strictEqual(res.statusCode, 200);
});

test("secret configured -> missing header is 401", () => {
  writeSecret("s3cr3t");
  const { nexted, res } = run({});
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 401);
});

test("secret configured -> wrong header is 401", () => {
  writeSecret("s3cr3t");
  const { nexted, res } = run({ "x-enrich-secret": "nope" });
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 401);
});

test("secret configured -> matching header passes", () => {
  writeSecret("s3cr3t");
  const { nexted, res } = run({ "X-Enrich-Secret": "s3cr3t" });
  assert.strictEqual(nexted, true);
  assert.strictEqual(res.statusCode, 200);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
