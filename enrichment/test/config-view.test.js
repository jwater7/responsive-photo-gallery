// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// config-view: the read-only, secret-safe config snapshots for the admin panel,
// split by owning process (workerConfig vs serviceConfig). The load-bearing
// property is that secrets never appear and URL credentials are stripped.
// Run: npm test  (from enrichment/)

const test = require("node:test");
const assert = require("node:assert");

const { workerConfig, serviceConfig, hostOnly } = require("../src/lib/config-view");

test("no config view exposes a secret-looking env var or the Meili master key", () => {
  for (const view of [workerConfig(), serviceConfig()]) {
    const flat = JSON.stringify(view);
    assert.ok(!flat.includes("MEILI_MASTER_KEY"));
    for (const cat of view) {
      for (const it of cat.items) {
        assert.doesNotMatch(it.env, /KEY|SECRET|PASSWORD|TOKEN/i, `leaked env ${it.env}`);
      }
    }
  }
});

test("the two views are disjoint and cover their owners", () => {
  const envs = (view) => view.flatMap((c) => c.items.map((i) => i.env));
  const worker = envs(workerConfig());
  const service = envs(serviceConfig());
  // Worker owns OCR + scan/watcher; service owns search + connections.
  assert.ok(worker.includes("OCR_MIN_CONFIDENCE"));
  assert.ok(worker.includes("WATCH_ENABLED"));
  assert.ok(service.includes("DEFAULT_SEMANTIC_RATIO"));
  assert.ok(service.includes("MEILI_HOST_URL"));
  // No setting appears in both objects (clean separation of concerns).
  assert.deepStrictEqual(worker.filter((e) => service.includes(e)), []);
});

test("hostOnly strips credentials and path from a URL", () => {
  assert.strictEqual(hostOnly("redis://user:pass@redis:6379/0"), "redis://redis:6379");
  assert.strictEqual(hostOnly("http://rpg-meilisearch:7700"), "http://rpg-meilisearch:7700");
  assert.strictEqual(hostOnly(""), "");
  assert.strictEqual(hostOnly("not a url"), "(set)");
});

test("each item carries label/env/value/default/source; source flags overrides", () => {
  const saved = process.env.OCR_MIN_CONFIDENCE;
  try {
    delete process.env.OCR_MIN_CONFIDENCE;
    delete require.cache[require.resolve("../src/lib/config")];
    delete require.cache[require.resolve("../src/lib/config-view")];
    const cv = require("../src/lib/config-view");
    const ocr = cv.workerConfig().find((c) => c.category === "OCR");
    const minConf = ocr.items.find((i) => i.env === "OCR_MIN_CONFIDENCE");
    assert.deepStrictEqual(Object.keys(minConf).sort(), ["default", "env", "label", "source", "value"]);
    assert.strictEqual(minConf.source, "default");
    assert.strictEqual(minConf.value, 50);
  } finally {
    if (saved != null) process.env.OCR_MIN_CONFIDENCE = saved;
    delete require.cache[require.resolve("../src/lib/config")];
    delete require.cache[require.resolve("../src/lib/config-view")];
  }
});
