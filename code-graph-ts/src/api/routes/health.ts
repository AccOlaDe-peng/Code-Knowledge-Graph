// Health and info routes

import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.get('/', async () => {
    return {
      service: 'Code Knowledge Graph — Agent Pipeline',
      version: '0.1.0',
      endpoints: {
        health: 'GET /health',
        analyze: {
          submit: 'POST /analyze/repository',
          status: 'GET /analyze/status/:sessionId',
          stream: 'GET /analyze/stream/:sessionId',
          cancel: 'POST /analyze/cancel/:sessionId',
        },
        graph: {
          full: 'GET /graph/:sessionId',
          framework: 'GET /graph/:sessionId/framework',
          call: 'GET /graph/:sessionId/call',
          lineage: 'GET /graph/:sessionId/lineage',
          stats: 'GET /graph/:sessionId/stats',
        },
      },
    };
  });
}
