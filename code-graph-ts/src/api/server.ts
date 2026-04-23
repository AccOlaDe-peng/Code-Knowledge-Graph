// Fastify API server

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.ts';
import { analyzeRoutes } from './routes/analyze.ts';
import { graphRoutes } from './routes/graph.ts';
import { cleanup } from './sessions.ts';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';

async function createServer() {
  const app = Fastify({
    logger: {
      level: 'info',
    },
  });

  // CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // Routes
  app.register(healthRoutes);
  app.register(analyzeRoutes, { prefix: '/api' });
  app.register(graphRoutes, { prefix: '/api' });

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
