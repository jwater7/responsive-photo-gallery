// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

// visual enricher video branch + v2 refresh semantics: keyframe vectors ONLY
// as the multi-vector (the metadata-text vector was measured out — CLIP
// text↔text scores are high for ANY query, so it made every video outrank
// every image; see the visual.js header), tags from the pooled frame vectors,
// extraction soft-fail, and the v2 stored-embedding reuse that makes the
// version bump a cheap tag recompute instead of a mass re-embed (Force still
// recomputes). embedder / video-frames are stubbed via the CJS require cache
// (injected BEFORE visual.js loads), so this runs hermetically with no
// onnxruntime, model download, or ffmpeg. Run: npm test  (from enrichment/)

const os = require("os");
const fs = require("fs");
const path = require("path");

// rpg-config resolves its files from CONFIG_PATH at load — give it a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-visual-video-test-"));
process.env.CONFIG_PATH = path.join(tmp, "config");
fs.mkdirSync(process.env.CONFIG_PATH, { recursive: true });

const test = require("node:test");
const assert = require("node:assert");

// ---- stubs (must land in the require cache before visual.js loads) ---------
function stub(relPath, exports) {
  const abs = require.resolve(relPath);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

const embedImageCalls = [];
const embedTextCalls = [];
stub("../src/lib/embedder", {
  embedImage: async (input) => {
    embedImageCalls.push(input);
    return [1, 0];
  },
  embedText: async (text) => {
    embedTextCalls.push(text);
    return [1, 0];
  },
  normalize: (v) => {
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    return Array.from(v, (x) => x / n);
  },
});

let keyframesFail = false;
const FRAMES = [Buffer.from("f1"), Buffer.from("f2"), Buffer.from("f3")];
stub("../src/lib/video-frames", {
  keyframes: async () => {
    if (keyframesFail) throw new Error("boom: Invalid data found");
    return FRAMES;
  },
  sampleTimes: () => [],
});

const visual = require("../src/enrichers/visual");
const config = require("../src/lib/config");

// Label vectors and stored vectors are all [1,0] in this harness.
config.embedDimensions = 2;

const clip = (relPath) => ({ file: { relPath }, absPath: `/images/${relPath}` });

test("video: exactly one vector per keyframe — no metadata-text vector", async () => {
  embedImageCalls.length = embedTextCalls.length = 0;

  const out = await visual.enrich({ ...clip("vacations/beach/IMG_1234.MOV"), existing: null });

  assert.strictEqual(out.embedded, true);
  assert.strictEqual(out.error, undefined);
  const vectors = out._vectors[config.embedderName];
  assert.ok(Array.isArray(vectors) && Array.isArray(vectors[0]), "multi-vector (array of vectors)");
  assert.strictEqual(vectors.length, FRAMES.length, "frame vectors only");
  // The frames were embedded as in-memory buffers (piped PNGs), never paths.
  assert.deepStrictEqual(embedImageCalls, FRAMES);
  // Only the zero-shot LABEL texts are ever embedded — no place/filename text
  // (the measured rank polluter this version removed).
  for (const t of embedTextCalls) assert.match(t, /^a photo of /);
  assert.ok(Array.isArray(out.tags), "tags from the pooled frame vectors");
});

test("video: extraction failure is a soft error with nothing durable", async () => {
  keyframesFail = true;
  try {
    const out = await visual.enrich({ ...clip("alb/broken.mp4"), existing: null });
    assert.match(out.error, /keyframe extraction failed: boom/);
    assert.ok(!("embedded" in out) && !("tags" in out) && !("_vectors" in out), "nothing durable");
  } finally {
    keyframesFail = false;
  }
});

// ---- v2 refresh: reuse the stored embedding instead of re-running CLIP -----

const storedDoc = (over = {}) => ({
  visual_version: 1,
  embedded: true,
  _vectors: { [config.embedderName]: { embeddings: [[1, 0]], regenerate: false } },
  ...over,
});

test("v1 image doc: tags recomputed from the STORED vector, no re-embed, vector untouched", async () => {
  embedImageCalls.length = 0;
  const out = await visual.enrich({ ...clip("alb/photo.jpg"), existing: storedDoc(), forced: false });
  assert.strictEqual(out.embedded, true);
  assert.ok(Array.isArray(out.tags));
  assert.deepStrictEqual(embedImageCalls, [], "stored embedding reused — CLIP not run");
  assert.ok(!("_vectors" in out), "stored vector left in place (no rewrite, no opt-out needed)");
});

test("Force recomputes for real (reuse bypassed)", async () => {
  embedImageCalls.length = 0;
  const out = await visual.enrich({ ...clip("alb/photo.jpg"), existing: storedDoc(), forced: true });
  assert.deepStrictEqual(embedImageCalls, ["/images/alb/photo.jpg"], "forced → full re-embed");
  assert.ok(out._vectors, "fresh vector written");
});

test("no reuse when the stored shape doesn't fit (dims mismatch, multi-vector, no vector)", async () => {
  // Wrong dimensions → recompute.
  embedImageCalls.length = 0;
  await visual.enrich({
    ...clip("alb/photo.jpg"),
    existing: storedDoc({ _vectors: { [config.embedderName]: { embeddings: [[1, 0, 0]] } } }),
    forced: false,
  });
  assert.strictEqual(embedImageCalls.length, 1);

  // Multi-vector doc (a video's) → the image path never reuses it.
  embedImageCalls.length = 0;
  await visual.enrich({
    ...clip("alb/photo.jpg"),
    existing: storedDoc({ _vectors: { [config.embedderName]: { embeddings: [[1, 0], [0, 1]] } } }),
    forced: false,
  });
  assert.strictEqual(embedImageCalls.length, 1);

  // No stored vector at all → recompute.
  embedImageCalls.length = 0;
  await visual.enrich({ ...clip("alb/photo.jpg"), existing: { visual_version: 1, embedded: true }, forced: false });
  assert.strictEqual(embedImageCalls.length, 1);
});

test("versioning: v1 docs are stale (cheap refresh), v2 docs current; videos re-derive", () => {
  const { isCurrent } = require("../src/lib/pipeline");
  assert.strictEqual(visual.version, 2);
  // v1 image docs re-run (reuse path, cheap); v2 docs skip.
  assert.strictEqual(isCurrent({ visual_version: 1, embedded: true }, visual), false);
  assert.strictEqual(isCurrent({ visual_version: 2, embedded: true }, visual), true);
  // v1 VIDEO docs re-run through the video branch (never the reuse path), so
  // their stored 4-vector (with the text vector) is replaced by frames-only.
  assert.ok(visual.applies({ relPath: "alb/clip.mp4" }));
});
