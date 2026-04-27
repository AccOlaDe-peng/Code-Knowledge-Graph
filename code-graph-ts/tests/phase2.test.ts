import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { LocalFileStore } from '../src/graph/store/LocalFileStore.ts';
import { TaskQueue } from '../src/queue/TaskQueue.ts';
import { broadcast, registerClient, unregisterClient } from '../src/api/routes/sse.ts';
import type { SSEClient } from '../src/api/routes/sse.ts';
import type { GraphData, GraphNode, GraphEdge } from '../src/graph/schema.ts';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── LocalFileStore Tests ──────────────────────────────────────────

describe('LocalFileStore', () => {
  let store: LocalFileStore;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `code-graph-test-${Date.now()}`);
    store = new LocalFileStore(testDir);
  });

  afterEach(() => {
    // Cleanup test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  const sampleNodes: GraphNode[] = [
    { id: 'node-1', type: 'module', label: 'AuthService', properties: { path: '/src/auth' } },
    { id: 'node-2', type: 'module', label: 'UserService', properties: { path: '/src/user' } },
  ];

  const sampleEdges: GraphEdge[] = [
    { source: 'node-1', target: 'node-2', type: 'depends_on', properties: {} },
  ];

  const sampleGraph: GraphData = {
    nodes: sampleNodes,
    edges: sampleEdges,
  };

  test('save creates graph file', async () => {
    await store.save('test-session', sampleGraph);

    const filePath = path.join(testDir, 'graphs', 'test-session.json');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('load returns saved graph', async () => {
    await store.save('test-session', sampleGraph);

    const loaded = await store.load('test-session');
    expect(loaded).toBeDefined();
    expect(loaded!.nodes.length).toBe(2);
    expect(loaded!.edges.length).toBe(1);
    expect(loaded!.nodes[0].label).toBe('AuthService');
  });

  test('load returns null for nonexistent session', async () => {
    const loaded = await store.load('nonexistent');
    expect(loaded).toBeNull();
  });

  test('delete removes graph file', async () => {
    await store.save('test-session', sampleGraph);
    expect(await store.exists('test-session')).toBe(true);

    const deleted = await store.delete('test-session');
    expect(deleted).toBe(true);
    expect(await store.exists('test-session')).toBe(false);
  });

  test('exists returns correct status', async () => {
    expect(await store.exists('test-session')).toBe(false);
    await store.save('test-session', sampleGraph);
    expect(await store.exists('test-session')).toBe(true);
  });

  test('getMetadata returns metadata', async () => {
    await store.save('test-session', sampleGraph);

    const meta = await store.getMetadata('test-session');
    expect(meta).toBeDefined();
    expect(meta!.sessionId).toBe('test-session');
    expect(meta!.nodeCount).toBe(2);
    expect(meta!.edgeCount).toBe(1);
  });

  test('listSessions returns all sessions', async () => {
    await store.save('session-1', sampleGraph);
    await store.save('session-2', sampleGraph);

    const sessions = await store.listSessions();
    expect(sessions.length).toBe(2);
    expect(sessions.map(s => s.sessionId)).toContain('session-1');
    expect(sessions.map(s => s.sessionId)).toContain('session-2');
  });

  test('addNodes appends new nodes', async () => {
    await store.save('test-session', sampleGraph);

    const newNode: GraphNode = { id: 'node-3', type: 'module', label: 'NewModule', properties: {} };
    const added = await store.addNodes('test-session', [newNode]);
    expect(added).toBe(true);

    const loaded = await store.load('test-session');
    expect(loaded!.nodes.length).toBe(3);
  });

  test('addNodes skips duplicates', async () => {
    await store.save('test-session', sampleGraph);

    const duplicate: GraphNode = { id: 'node-1', type: 'module', label: 'Duplicate', properties: {} };
    const added = await store.addNodes('test-session', [duplicate]);
    expect(added).toBe(true);

    const loaded = await store.load('test-session');
    expect(loaded!.nodes.length).toBe(2); // Still 2, no duplicate added
  });

  test('addEdges appends new edges', async () => {
    await store.save('test-session', sampleGraph);

    const newEdge: GraphEdge = { source: 'node-2', target: 'node-1', type: 'calls', properties: {} };
    const added = await store.addEdges('test-session', [newEdge]);
    expect(added).toBe(true);

    const loaded = await store.load('test-session');
    expect(loaded!.edges.length).toBe(2);
  });
});

// ── TaskQueue Tests ───────────────────────────────────────────────

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue({ concurrency: 2 });
    // Register a default handler that doesn't do much
    queue.registerHandler('analyze', async (task, updateProgress) => {
      // Simple handler - just return empty result
      await new Promise(r => setTimeout(r, 10));
      return { nodes: [], edges: [] };
    });
  });

  test('enqueue creates task', async () => {
    const taskId = await queue.enqueue('analyze', { path: '/test/repo' });
    expect(taskId).toBeDefined();
    expect(taskId.startsWith('session-') || taskId.includes('-')).toBe(true);
  });

  test('getStatus returns task', async () => {
    const taskId = await queue.enqueue('analyze', { path: '/test/repo' });
    // Wait for task to complete
    await new Promise(r => setTimeout(r, 50));
    const task = await queue.getStatus(taskId);
    expect(task).toBeDefined();
    expect(task!.status).toBe('completed');
  });

  test('getTaskBySession finds task', async () => {
    await queue.enqueue('analyze', { path: '/test/repo' }, { sessionId: 'my-session' });
    // Wait for task to complete
    await new Promise(r => setTimeout(r, 50));
    const task = await queue.getTaskBySession('my-session');
    expect(task).toBeDefined();
    expect(task!.sessionId).toBe('my-session');
  });

  test('cancel running task returns false', async () => {
    // Create queue with slow handler
    const slowQueue = new TaskQueue({ concurrency: 1 });
    slowQueue.registerHandler('analyze', async (task, updateProgress) => {
      await new Promise(r => setTimeout(r, 500));
      return {};
    });

    const taskId = await slowQueue.enqueue('analyze', { path: '/test/repo' });
    // Wait a bit for task to start running
    await new Promise(r => setTimeout(r, 20));

    const cancelled = await slowQueue.cancel(taskId);
    // Once running, cancel returns false
    expect(cancelled).toBe(false);
  });

  test('cancel returns false for completed task', async () => {
    const taskId = await queue.enqueue('analyze', { path: '/test/repo' });
    // Wait for completion
    await new Promise(r => setTimeout(r, 100));

    const cancelled = await queue.cancel(taskId);
    expect(cancelled).toBe(false); // Already completed
  });

  test('getStats returns correct counts', async () => {
    // Stop auto-processing by creating queue without handler
    const testQueue = new TaskQueue({ concurrency: 2 });
    // Don't register handler - tasks will stay pending longer

    const id1 = await testQueue.enqueue('analyze', { path: '/test/1' });
    const id2 = await testQueue.enqueue('analyze', { path: '/test/2' });

    // Check immediately before they get processed
    const stats = testQueue.getStats();
    expect(stats.pending + stats.running + stats.failed).toBeGreaterThanOrEqual(2);
  });

  test('handler executes and updates progress', async () => {
    const progressUpdates: number[] = [];

    queue.registerHandler('analyze', async (task, updateProgress) => {
      updateProgress(25);
      progressUpdates.push(25);
      updateProgress(50);
      progressUpdates.push(50);
      updateProgress(100);
      progressUpdates.push(100);
      return { nodes: [], edges: [] };
    });

    const taskId = await queue.enqueue('analyze', { path: '/test/repo' });

    // Wait for completion
    await new Promise(r => setTimeout(r, 100));

    const task = await queue.getStatus(taskId);
    expect(task!.status).toBe('completed');
    expect(task!.progress).toBe(100);
    expect(progressUpdates.length).toBe(3);
  });

  test('SSE notifier receives events', async () => {
    const events: Array<{ event: string; data: unknown }> = [];

    queue.setSSENotifier((sessionId, event, data) => {
      events.push({ event, data });
    });

    queue.registerHandler('analyze', async (task, updateProgress) => {
      updateProgress(50);
      return { result: 'done' };
    });

    const taskId = await queue.enqueue('analyze', { path: '/test/repo' });

    // Wait for completion
    await new Promise(r => setTimeout(r, 100));

    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.event === 'progress')).toBe(true);
    expect(events.some(e => e.event === 'complete')).toBe(true);
  });

  test('error handling', async () => {
    queue.registerHandler('analyze', async (task, updateProgress) => {
      throw new Error('Test error');
    });

    const taskId = await queue.enqueue('analyze', { path: '/test/repo' });

    // Wait for failure
    await new Promise(r => setTimeout(r, 100));

    const task = await queue.getStatus(taskId);
    expect(task!.status).toBe('failed');
    expect(task!.error).toBe('Test error');
  });

  test('concurrency limit', async () => {
    const runningCount: number[] = [];

    queue = new TaskQueue({ concurrency: 1 });

    queue.registerHandler('analyze', async (task, updateProgress) => {
      runningCount.push(queue.getStats().running);
      await new Promise(r => setTimeout(r, 50));
      return {};
    });

    await queue.enqueue('analyze', { path: '/test/1' });
    await queue.enqueue('analyze', { path: '/test/2' });
    await queue.enqueue('analyze', { path: '/test/3' });

    // Wait for all to complete
    await new Promise(r => setTimeout(r, 200));

    // At most 1 should be running at any time
    expect(Math.max(...runningCount)).toBeLessThanOrEqual(1);
  });
});

// ── SSE Broadcaster Tests ─────────────────────────────────────────

describe('SSE Broadcaster', () => {
  test('registerClient adds to clients map', () => {
    const mockReply = { raw: { write: () => true } };
    const client: SSEClient = {
      sessionId: 'test-session',
      reply: mockReply,
      connected: true,
    };

    registerClient(client);
    broadcast('test-session', 'test', { data: 'hello' });
    unregisterClient(client);
  });

  test('broadcast sends to connected clients', () => {
    const messages: string[] = [];
    const mockReply = { raw: { write: (msg: string) => { messages.push(msg); return true; } } };
    const client: SSEClient = {
      sessionId: 'test-session',
      reply: mockReply,
      connected: true,
    };

    registerClient(client);
    broadcast('test-session', 'progress', { value: 50 });

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('event: progress');
    expect(messages[0]).toContain('50');

    unregisterClient(client);
  });

  test('broadcast skips disconnected clients', () => {
    const messages: string[] = [];
    const mockReply = { raw: { write: (msg: string) => { messages.push(msg); return true; } } };
    const client: SSEClient = {
      sessionId: 'test-session',
      reply: mockReply,
      connected: false,
    };

    registerClient(client);
    broadcast('test-session', 'progress', { value: 50 });

    expect(messages.length).toBe(0);

    unregisterClient(client);
  });

  test('broadcast handles non-existent session', () => {
    // Should not throw
    broadcast('nonexistent-session', 'test', { data: 'hello' });
  });
});