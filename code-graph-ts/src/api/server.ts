// Fastify API server

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.ts';
import { analyzeRoutes } from './routes/analyze.ts';
import { graphRoutes } from './routes/graph.ts';
import { lineageRoutes } from './routes/lineage.ts';
import { reposRoutes } from './routes/repos.ts';
import { frontendRoutes } from './routes/frontend.ts';
import { cleanup } from './sessions.ts';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_PORT = 8848;
const DEFAULT_HOST = '0.0.0.0';
const LOG_DIR = resolve(import.meta.dir, '../../logs');

async function ensureLogDir() {
  try {
    await mkdir(LOG_DIR, { recursive: true });
  } catch {
    // 目录已存在
  }
}

async function createServer() {
  await ensureLogDir();

  const isDev = process.env.NODE_ENV !== 'production';

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
      transport: isDev
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
        : undefined,
      file: resolve(LOG_DIR, 'server.log'),
    },
  });

  // CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  // Routes
  app.register(healthRoutes);

  // Frontend-compatible routes (no /api prefix, matches Python backend)
  app.register(reposRoutes);
  app.register(frontendRoutes);

  // Original API routes (with /api prefix)
  app.register(analyzeRoutes, { prefix: '/api' });
  app.register(graphRoutes, { prefix: '/api' });
  app.register(lineageRoutes, { prefix: '/api' });

  // Session cleanup every 30 minutes
  const cleanupInterval = setInterval(() => cleanup(), 30 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    clearInterval(cleanupInterval);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return app;
}

async function startServer(port: number = DEFAULT_PORT, host: string = DEFAULT_HOST) {
  const app = await createServer();

  try {
    await app.listen({ port, host });
    app.log.info(`Code Knowledge Graph API running on http://${host}:${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  return app;
}

export { createServer, startServer };
