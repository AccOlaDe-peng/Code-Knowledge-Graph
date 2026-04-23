import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { createServer } from '../src/api/server.ts';
import type { FastifyInstance } from 'fastify';

describe('API Health Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createServer();
  });

  afterEach(async () => {
    await app.close();
  });

  test('GET /health returns ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
  });

  test('GET / returns service info', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.service).toContain('Code Knowledge Graph');
    expect(body.endpoints).toBeDefined();
  });
});

describe('API Analyze Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createServer();
  });

  afterEach(async () => {
    await app.close();
  });

  test('POST /api/analyze/repository requires path', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/analyze/repository',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  test('POST /api/analyze/repository returns session id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/analyze/repository',
      payload: { path: '/tmp/nonexistent-test-repo' },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.sessionId).toBeDefined();
    expect(body.status).toBe('pending');
  });

  test('GET /api/analyze/status/:sessionId returns 404 for unknown session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/analyze/status/unknown-session',
    });

    expect(response.statusCode).toBe(404);
  });

  test('GET /api/analyze/status/:sessionId returns progress', async () => {
    // Create session first
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/analyze/repository',
      payload: { path: '/tmp/nonexistent-test-repo' },
    });
    const { sessionId } = JSON.parse(createResponse.body);

    const response = await app.inject({
      method: 'GET',
      url: `/api/analyze/status/${sessionId}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.sessionId).toBe(sessionId);
    expect(['pending', 'running', 'completed', 'failed']).toContain(body.status);
  });
});

describe('API Graph Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createServer();
  });

  afterEach(async () => {
    await app.close();
  });

  test('GET /api/graph/:sessionId returns 404 for unknown session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph/unknown-session',
    });

    expect(response.statusCode).toBe(404);
  });

  test('GET /api/graph/:sessionId/stats returns 404 for unknown session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph/unknown-session/stats',
    });

    expect(response.statusCode).toBe(404);
  });
});
