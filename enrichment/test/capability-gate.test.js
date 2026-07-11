// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// Per-plane format support matrix (capability-aware): pixel-decoding enrichers
// (visual, OCR) gate on the build's actual decoder capability and soft-fail
// undecodable formats with a stable recorded reason — no decode attempt, no
// version stamp, so a later capable build heals them on re-scan. Metadata-only
// enrichers (geo, caption) take every registry image format unconditionally.
// The decodable probe and the engines are stubbed via the CJS require cache
// (injected BEFORE the enrichers load) so both capability outcomes run in one
// hermetic process. Run: npm test  (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

// rpg-config resolves its files from CONFIG_PATH at load — give it a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-capability-gate-test-"));
process.env.CONFIG_PATH = path.join(tmp, "config");
fs.mkdirSync(process.env.CONFIG_PATH, { recursive: true });

const test = require("node:test");
const assert = require("node:assert");

// ---- stub the capability probe (controls both outcomes) --------------------
let decodable = new Set([".jpg"]);
const decodablePath = require.resolve("../src/lib/decodable");
require.cache[decodablePath] = {
  id: decodablePath,
  filename: decodablePath,
  loaded: true,
  exports: {
    isDecodableImage: (p) => decodable.has(path.extname(p).toLowerCase()),
    undecodableError: (p) =>
      `undecodable: no ${path.extname(p).toLowerCase()} decoder in this sharp build`,
  },
};

// ---- stub the pixel pipelines (must NOT be reached when gated) -------------
const embedderCalls = [];
const embedderPath = require.resolve("../src/lib/embedder");
require.cache[embedderPath] = {
  id: embedderPath,
  filename: embedderPath,
  loaded: true,
  exports: {
    embedImage: async (p) => {
      embedderCalls.push(p);
      return [1, 0];
    },
    embedText: async () => [1, 0],
  },
};

const engineCalls = [];
const enginePath = require.resolve("../src/enrichers/ocr-engines");
require.cache[enginePath] = {
  id: enginePath,
  filename: enginePath,
  loaded: true,
  exports: {
    recognize: async (p) => {
      engineCalls.push(p);
      return { content: "hello", confidence: 90 };
    },
  },
};

const visual = require("../src/enrichers/visual");
const ocr = require("../src/enrichers/ocr");
const caption = require("../src/enrichers/caption");
const geo = require("../src/enrichers/geo");

test("visual: undecodable format soft-fails without touching the embedder", async () => {
  const out = await visual.enrich({ absPath: "/img/scan.heic" });
  assert.match(out.error, /undecodable: no \.heic decoder/);
  assert.ok(!("embedded" in out) && !("_vectors" in out), "nothing durable");
  assert.deepStrictEqual(embedderCalls, [], "no decode attempt");
});

test("visual: decodable format proceeds (capability upgrade self-heals)", async () => {
  decodable = new Set([".jpg", ".heic"]); // a HEIF-capable build
  const out = await visual.enrich({ absPath: "/img/scan.heic" });
  assert.strictEqual(out.embedded, true);
  assert.deepStrictEqual(embedderCalls, ["/img/scan.heic"]);
  decodable = new Set([".jpg"]);
});

test("ocr: undecodable format soft-fails without touching the engine", async () => {
  const out = await ocr.enrich({ absPath: "/img/photo.bmp" });
  assert.match(out.error, /undecodable: no \.bmp decoder/);
  assert.strictEqual(out.content, "");
  assert.deepStrictEqual(engineCalls, [], "no decode attempt");
});

test("ocr: decodable format proceeds", async () => {
  const out = await ocr.enrich({ absPath: "/img/photo.jpg" });
  assert.strictEqual(out.content, "hello");
  assert.strictEqual(out.error, undefined);
  assert.deepStrictEqual(engineCalls, ["/img/photo.jpg"]);
});

test("every registry image format applies to all four enrichers", () => {
  // The gate lives INSIDE enrich() for the pixel stages; applies() must accept
  // the full registry so undecodable files get a recorded reason instead of
  // silently never being considered. Metadata-only stages have no gate at all.
  for (const relPath of ["a.heic", "b.avif", "c.gif", "d.bmp", "e.jpg"]) {
    for (const enricher of [visual, ocr, caption, geo]) {
      assert.ok(
        enricher.applies({ relPath }),
        `${enricher.name} must apply to ${relPath}`
      );
    }
  }
});

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
