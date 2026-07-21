#!/usr/bin/env node
// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Enrichment API service — the light, latency-sensitive plane.
 *
 * Serves the Express API (search, status, sync/reap triggers, Swagger) and
 * /health. The heavy enrichment work (the BullMQ worker, the reconcile walk, the
 * watcher, the cron) runs in a SEPARATE process (src/bin/worker.js) so it can't
 * block this event loop or its /health probe; this process only accepts triggers
 * (forwarded to the worker over a Redis control queue) and reads status from
 * Redis. The search-time text embed runs here (it's a single short string per
 * request). The service boots even when Redis/MeiliSearch are down and retries
 * lazily.
 */

const path = require("path");
const express = require("express");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");

const config = require("../lib/config");
const meili = require("../lib/meili");
const queue = require("../lib/queue");
const requireSharedSecret = require("../lib/require-shared-secret");
const router = require("../routes/enrichment-api");
const pjson = require(path.resolve(__dirname, "../../package.json"));

const debug = require("debug")("responsive-photo-gallery:server");
const debugErr = require("debug")("responsive-photo-gallery:server:error");
// Errors are operational signals, not opt-in tracing: force the :error namespace
// on regardless of the DEBUG filter, so narrowing DEBUG (e.g. to debug one
// subsystem) can never silently swallow failures. They still flow through debug's
// formatter, so they keep the timestamp.
debugErr.enabled = true;

function buildSwaggerSpec() {
  return swaggerJsdoc({
    definition: {
      swagger: "2.0",
      info: { title: "Image Enrichment Service API", version: pjson.version },
      basePath: "/api/v1",
      securityDefinitions: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "Authorization" },
      },
    },
    apis: [path.join(__dirname, "../routes/enrichment-api.js")],
  });
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const spec = buildSwaggerSpec();
  app.get("/swagger.json", (req, res) => res.json(spec));
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(spec));
  // Optional shared-secret gate (fail-open) in front of the API only; /health,
  // /swagger.json and /api-docs stay open (health is probed without the secret).
  app.use("/api/v1", requireSharedSecret, router);
  app.get("/health", (req, res) => res.json({ status: "ok" }));

  // Best-effort MeiliSearch connect; never fatal (search re-inits lazily).
  try {
    await meili.init();
  } catch (err) {
    debugErr("MeiliSearch not reachable at boot: %s", err.message);
  }

  const server = app.listen(config.port, () => {
    debug("listening on :%d | swagger /api-docs | redis %s", config.port, config.redisUrl);
  });

  const shutdown = async () => {
    debug("shutting down...");
    await queue.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  debugErr("Fatal startup error: %s", err.message);
  process.exit(1);
});
