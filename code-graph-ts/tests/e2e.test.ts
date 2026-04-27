import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from '../src/api/routes/health.ts';
import { analyzeRoutes } from '../src/api/routes/analyze.ts';
import { graphRoutes } from '../src/api/routes/graph.ts';
import { lineageRoutes } from '../src/api/routes/lineage.ts';
import { LocalFileStore } from '../src/graph/store/LocalFileStore.ts';
import { TaskQueue } from '../src/queue/TaskQueue.ts';
import type { GraphNode, GraphEdge } from '../src/graph/schema.ts';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── E2E Integration Tests ─────────────────────────────────────────

describe('End-to-End Integration', () => {
  let app: ReturnType<typeof Fastify>;
  let testDir: string;
  let store: LocalFileStore;
  let queue: TaskQueue;

  beforeAll(async () => {
    // Setup test server
    app = Fastify({ logger: false });
    await app.register(cors, { origin: true, credentials: true });
    app.register(healthRoutes);
    app.register(analyzeRoutes, { prefix: '/api' });
    app.register(graphRoutes, { prefix: '/api' });
    app.register(lineageRoutes, { prefix: '/api' });
    await app.ready();

    // Setup test storage
    testDir = path.join(os.tmpdir(), `e2e-test-${Date.now()}`);
    store = new LocalFileStore(testDir);
    queue = new TaskQueue({ concurrency: 2 });
  });

  afterAll(async () => {
    await app.close();
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  // ── Health Check ───────────────────────────────────────────────

  test('GET /health returns ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  // ── Analysis Workflow ────────────────────────────────────────

  test('POST /api/analyze/repository creates session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/analyze/repository',
      payload: {
        path: '/test/repo',
        enableLineage: true,
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json() as { sessionId: string; status: string };
    expect(body.sessionId).toBeDefined();
    expect(body.status).toBe('pending');
  });

  test('GET /api/analyze/status/:sessionId returns session info', async () => {
    // First create a session
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/analyze/repository',
      payload: { path: '/test/repo' },
    });
    const { sessionId } = createResponse.json() as { sessionId: string };

    // Then check status
    const statusResponse = await app.inject({
      method: 'GET',
      url: `/api/analyze/status/${sessionId}`,
    });

    expect(statusResponse.statusCode).toBe(200);
    const body = statusResponse.json() as { sessionId: string; status: string };
    expect(body.sessionId).toBe(sessionId);
    expect(['pending', 'running', 'completed', 'failed']).toContain(body.status);
  });

  test('GET /api/analyze/status/unknown returns 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/analyze/status/unknown-session',
    });

    expect(response.statusCode).toBe(404);
  });

  // ── Graph Operations ─────────────────────────────────────────

  test('GET /api/graph/:sessionId returns graph data', async () => {
    // Create test graph
    const nodes: GraphNode[] = [
      { id: 'e2e-1', type: 'module', label: 'E2EService', properties: { file: '/e2e.ts' } },
      { id: 'e2e-2', type: 'module', label: 'E2ERepo', properties: { file: '/e2e-repo.ts' } },
    ];
    const edges: GraphEdge[] = [
      { source: 'e2e-1', target: 'e2e-2', type: 'depends_on', properties: {} },
    ];

    await store.save('e2e-session', { nodes, edges });

    const response = await app.inject({
      method: 'GET',
      url: '/api/graph/e2e-session',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { nodes: GraphNode[]; edges: GraphEdge[] };
    expect(body.nodes.length).toBe(2);
    expect(body.edges.length).toBe(1);
  });

  test('GET /api/graph/:sessionId/stats returns statistics', async () => {
    await store.save('stats-session', {
      nodes: [
        { id: 's1', type: 'module', label: 'StatsA', properties: {} },
        { id: 's2', type: 'module', label: 'StatsB', properties: {} },
        { id: 's3', type: 'module', label: 'StatsC', properties: {} },
      ],
      edges: [
        { source: 's1', target: 's2', type: 'calls', properties: {} },
        { source: 's2', target: 's3', type: 'calls', properties: {} },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/graph/stats-session/stats',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { nodeCount: number; edgeCount: number };
    expect(body.nodeCount).toBe(3);
    expect(body.edgeCount).toBe(2);
  });

  // ── Lineage API ──────────────────────────────────────────────

  test('GET /api/lineage/:sessionId/modules returns module list', async () => {
    await store.save('lineage-session', {
      nodes: [
        { id: 'm1', type: 'module', label: 'AuthService', properties: { file: '/auth.ts' } },
        { id: 'm2', type: 'module', label: 'UserService', properties: { file: '/user.ts' } },
      ],
      edges: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/lineage/lineage-session/modules',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Array<{ id: string; label: string; type: string }>;
    expect(body.length).toBe(2);
    expect(body.map(m => m.label)).toContain('AuthService');
  });

  test('GET /api/lineage/:sessionId/entity/:entityId returns entity lineage', async () => {
    await store.save('entity-session', {
      nodes: [
        { id: 'e1', type: 'module', label: 'OrderService', properties: { file: '/order.ts' } },
        { id: 'e2', type: 'module', label: 'PaymentService', properties: { file: '/payment.ts' } },
        { id: 'e3', type: 'module', label: 'ShippingService', properties: { file: '/shipping.ts' } },
      ],
      edges: [
        { source: 'e1', target: 'e2', type: 'calls', properties: {} },
        { source: 'e2', target: 'e3', type: 'calls', properties: {} },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/lineage/entity-session/entity/e1',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      entity: { id: string; label: string };
      upstream: unknown[];
      downstream: unknown[];
    };
    expect(body.entity.id).toBe('e1');
    expect(body.downstream.length).toBeGreaterThan(0);
  });

  // ── TaskQueue Integration ────────────────────────────────────

  test('TaskQueue processes tasks with progress', async () => {
    const progressValues: number[] = [];

    queue.registerHandler('analyze', async (task, updateProgress) => {
      updateProgress(25);
      progressValues.push(25);
      updateProgress(50);
      progressValues.push(50);
      updateProgress(100);
      progressValues.push(100);
      return { done: true };
    });

    const taskId = await queue.enqueue('analyze', { test: true });
    await new Promise(r => setTimeout(r, 100));

    const task = await queue.getStatus(taskId);
    expect(task!.status).toBe('completed');
    expect(progressValues).toEqual([25, 50, 100]);
  });

  test('TaskQueue SSE notifier integration', async () => {
    const events: Array<{ event: string; data: unknown }> = [];

    queue.setSSENotifier((sessionId, event, data) => {
      events.push({ event, data });
    });

    queue.registerHandler('analyze', async (task, updateProgress) => {
      updateProgress(50);
      return { result: 'complete' };
    });

    const taskId = await queue.enqueue('analyze', { path: '/test' });
    await new Promise(r => setTimeout(r, 100));

    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.event === 'progress')).toBe(true);
    expect(events.some(e => e.event === 'complete')).toBe(true);
  });

  // ── Storage Integration ─────────────────────────────────────

  test('LocalFileStore persists and loads graphs', async () => {
    const testGraph = {
      nodes: [
        { id: 'p1', type: 'module' as const, label: 'PersistentA', properties: {} },
        { id: 'p2', type: 'module' as const, label: 'PersistentB', properties: {} },
      ],
      edges: [
        { source: 'p1', target: 'p2', type: 'uses' as const, properties: {} },
      ],
    };

    await store.save('persist-session', testGraph);

    // Verify file exists
    const filePath = path.join(testDir, 'graphs', 'persist-session.json');
    expect(fs.existsSync(filePath)).toBe(true);

    // Load and verify
    const loaded = await store.load('persist-session');
    expect(loaded).toBeDefined();
    expect(loaded!.nodes.length).toBe(2);
    expect(loaded!.edges.length).toBe(1);
    expect(loaded!.nodes[0].label).toBe('PersistentA');
  });

  test('LocalFileStore lists sessions', async () => {
    await store.save('list-1', { nodes: [], edges: [] });
    await store.save('list-2', { nodes: [], edges: [] });
    await store.save('list-3', { nodes: [], edges: [] });

    const sessions = await store.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(3);
    expect(sessions.map(s => s.sessionId)).toContain('list-1');
    expect(sessions.map(s => s.sessionId)).toContain('list-2');
    expect(sessions.map(s => s.sessionId)).toContain('list-3');
  });

  // ── Cancel Workflow ─────────────────────────────────────────

  test('POST /api/analyze/cancel/:sessionId cancels running analysis', async () => {
    // Create a session
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/analyze/repository',
      payload: { path: '/test/cancel' },
    });
    const { sessionId } = createResponse.json() as { sessionId: string };

    // Try to cancel (may or may not succeed depending on timing)
    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/api/analyze/cancel/${sessionId}`,
    });

    // Either cancelled (if still pending) or 400 (if already running/completed)
    expect([200, 400]).toContain(cancelResponse.statusCode);
  });

  // ── Error Handling ─────────────────────────────────────────

  test('handles missing path in analyze request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/analyze/repository',
      payload: {}, // missing path
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toContain('required');
  });

  test('handles invalid JSON in request body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/analyze/repository',
      payload: 'not json',
      headers: { 'content-type': 'application/json' },
    });

    expect([400, 500]).toContain(response.statusCode);
  });
});
