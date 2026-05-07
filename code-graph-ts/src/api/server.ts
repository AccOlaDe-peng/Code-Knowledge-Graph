// Fastify API server

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { healthRoutes } from "./routes/health.ts";
import { analyzeRoutes } from "./routes/analyze.ts";
import { graphRoutes } from "./routes/graph.ts";
import { lineageRoutes } from "./routes/lineage.ts";
import { reposRoutes } from "./routes/repos.ts";
import { frontendRoutes } from "./routes/frontend.ts";
import { wsRoutes } from "./routes/ws.ts";
import { fsRoutes } from "./routes/fs.ts";
import { cleanup } from "./sessions.ts";
import { logger, logRequest, logResponse } from "./logger.ts";

const DEFAULT_PORT = 8848;
const DEFAULT_HOST = "0.0.0.0";

async function createServer() {
  const app = Fastify({
    logger: {
      level:
        process.env.LOG_LEVEL ??
        (process.env.NODE_ENV !== "production" ? "debug" : "info"),
    },
    disableRequestLogging: true,
  });

  // CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  });

  // WebSocket
  await app.register(websocket);

  // Request logging hook
  app.addHook("onRequest", async (request) => {
    const { method, url, query, params, headers, ip, body } = request;
    const headerObj = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    logRequest({
      method,
      url,
      query: query as Record<string, unknown> | undefined,
      params: params as Record<string, unknown> | undefined,
      body: body as unknown | undefined,
      headers: headerObj as Record<string, unknown>,
      ip,
    });
  });

  // Response logging hook
  app.addHook("onResponse", async (request, reply) => {
    logResponse({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      durationMs: reply.elapsedTime,
      contentLength: Number(reply.getHeader("content-length") ?? 0),
    });
  });

  // Routes
  app.register(healthRoutes);

  // Frontend-compatible routes (no /api prefix, matches Python backend)
  app.register(reposRoutes);
  app.register(frontendRoutes);

  // WebSocket routes
  app.register(wsRoutes);

  // Original API routes (with /api prefix)
  app.register(analyzeRoutes, { prefix: "/api" });
  app.register(graphRoutes, { prefix: "/api" });
  app.register(lineageRoutes, { prefix: "/api" });
  app.register(fsRoutes, { prefix: "/api" });

  // Session cleanup every 30 minutes
  const cleanupInterval = setInterval(() => cleanup(), 30 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    clearInterval(cleanupInterval);
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return app;
}

async function startServer(
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST,
) {
  const app = await createServer();

  try {
    await app.listen({ port, host });
    logger.info(`Code Knowledge Graph API running on http://${host}:${port}`);
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }

  return app;
}

export { createServer, startServer };
