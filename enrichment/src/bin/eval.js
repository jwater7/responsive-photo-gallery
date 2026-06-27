#!/usr/bin/env node
// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Tiny hybrid-search evaluator. Hits a running service's /api/v1/search for
 * each labeled case and reports whether the expected file appears in the top-K.
 * Sweep DEFAULT_SEMANTIC_RATIO (or pass --ratio=) to tune the keyword/vector mix.
 *
 *   node src/bin/eval.js [--base=http://localhost:8080] [--ratio=0.5]
 */

const fs = require("fs");
const path = require("path");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);

const base = args.base || `http://localhost:${process.env.ENRICHMENT_PORT || 8080}`;
const ratio = args.ratio !== undefined ? Number(args.ratio) : undefined;
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "../../eval/queries.json"), "utf8"));

(async () => {
  let pass = 0;
  for (const c of spec.cases) {
    const body = { query: c.query, limit: spec.topK };
    if (ratio !== undefined) body.semanticRatio = ratio;

    let hits;
    try {
      const res = await fetch(`${base}/api/v1/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      hits = (await res.json()).results || [];
    } catch (err) {
      console.log(`✗ ${c.query} — request failed: ${err.message}`);
      continue;
    }

    const ok = hits.some((h) => (h.path || "").includes(c.expectPathIncludes));
    if (ok) pass++;
    const top = hits.map((h) => h.path).slice(0, spec.topK).join(", ");
    console.log(`${ok ? "✓" : "✗"} "${c.query}" -> expect ~${c.expectPathIncludes} | top: ${top || "(none)"}`);
  }
  console.log(`\n${pass}/${spec.cases.length} passed${ratio !== undefined ? ` (semanticRatio=${ratio})` : ""}`);
  process.exit(pass === spec.cases.length ? 0 : 1);
})();
