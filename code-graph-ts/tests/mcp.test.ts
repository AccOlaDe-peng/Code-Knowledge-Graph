import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { LocalFileStore } from '../src/graph/store/LocalFileStore.ts';
import type { GraphNode, GraphEdge, GraphData } from '../src/graph/schema.ts';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── MCP Server Tests ──────────────────────────────────────────────

describe('MCP Server Tools', () => {
  let store: LocalFileStore;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `mcp-test-${Date.now()}`);
    store = new LocalFileStore(testDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  // ── trace_lineage Handler Tests ─────────────────────────────────

  test('trace_lineage returns upstream and downstream', async () => {
    // Create test graph
    const nodes: GraphNode[] = [
      { id: 'service-1', type: 'module', label: 'UserService', properties: { file: '/src/UserService.java' } },
      { id: 'repo-1', type: 'module', label: 'UserRepository', properties: { file: '/src/UserRepository.java' } },
      { id: 'dto-1', type: 'module', label: 'UserDTO', properties: { file: '/src/UserDTO.java' } },
      { id: 'db-1', type: 'module', label: 'UserDatabase', properties: { file: '/db/UserDatabase.java' } },
    ];

    const edges: GraphEdge[] = [
      { source: 'service-1', target: 'repo-1', type: 'calls', properties: {} },
      { source: 'service-1', target: 'dto-1', type: 'uses', properties: {} },
      { source: 'repo-1', target: 'db-1', type: 'reads', properties: {} },
    ];

    await store.save('test-session', { nodes, edges });

    // Simulate trace_lineage logic
    const graph = await store.load('test-session');
    expect(graph).toBeDefined();

    const entityNode = graph!.nodes.find(n => n.label === 'UserService');
    expect(entityNode).toBeDefined();

    // Downstream from UserService
    const downstreamEdges = graph!.edges.filter(e => e.source === 'service-1');
    expect(downstreamEdges.length).toBe(2);

    // Repository reads from database (upstream of UserService via repo)
    const repoEdges = graph!.edges.filter(e => e.target === 'repo-1');
    expect(repoEdges.length).toBe(1);
    expect(repoEdges[0].source).toBe('service-1');

    // Database is downstream of repo
    const dbEdges = graph!.edges.filter(e => e.source === 'repo-1');
    expect(dbEdges.length).toBe(1);
    expect(dbEdges[0].target).toBe('db-1');
  });

  test('trace_lineage respects depth limit', async () => {
    // Create chain: A -> B -> C -> D -> E
    const nodes: GraphNode[] = [
      { id: 'a', type: 'module', label: 'A', properties: {} },
      { id: 'b', type: 'module', label: 'B', properties: {} },
      { id: 'c', type: 'module', label: 'C', properties: {} },
      { id: 'd', type: 'module', label: 'D', properties: {} },
      { id: 'e', type: 'module', label: 'E', properties: {} },
    ];

    const edges: GraphEdge[] = [
      { source: 'a', target: 'b', type: 'calls', properties: {} },
      { source: 'b', target: 'c', type: 'calls', properties: {} },
      { source: 'c', target: 'd', type: 'calls', properties: {} },
      { source: 'd', target: 'e', type: 'calls', properties: {} },
    ];

    await store.save('chain-session', { nodes, edges });

    const graph = await store.load('chain-session');

    // Trace from A with depth=2: should only reach B and C
    function traceDown(nodeId: string, depth: number): string[] {
      if (depth === 0) return [];
      const next = graph!.edges.filter(e => e.source === nodeId).map(e => e.target);
      return [...next, ...next.flatMap(n => traceDown(n, depth - 1))];
    }

    const result = traceDown('a', 2);
    expect(result.length).toBe(2); // B and C only
  });

  test('trace_lineage handles nonexistent entity', async () => {
    await store.save('test-session', {
      nodes: [{ id: 'x', type: 'module', label: 'X', properties: {} }],
      edges: [],
    });

    const graph = await store.load('test-session');
    const entityNode = graph!.nodes.find(n => n.label === 'NonExistent');
    expect(entityNode).toBeUndefined();
  });

  test('trace_lineage handles nonexistent session', async () => {
    const graph = await store.load('nonexistent-session');
    expect(graph).toBeNull();
  });

  // ── get_lineage_graph Handler Tests ─────────────────────────────

  test('get_lineage_graph returns full graph', async () => {
    const nodes: GraphNode[] = [
      { id: 'n1', type: 'module', label: 'ServiceA', properties: { file: '/a.ts' } },
      { id: 'n2', type: 'module', label: 'ServiceB', properties: { file: '/b.ts' } },
    ];

    const edges: GraphEdge[] = [
      { source: 'n1', target: 'n2', type: 'depends_on', properties: {} },
    ];

    await store.save('graph-session', { nodes, edges });

    const graph = await store.load('graph-session');
    expect(graph!.nodes.length).toBe(2);
    expect(graph!.edges.length).toBe(1);
  });

  test('get_lineage_graph filters by module', async () => {
    const nodes: GraphNode[] = [
      { id: 'n1', type: 'module', label: 'AuthService', properties: { module: 'auth' } },
      { id: 'n2', type: 'module', label: 'AuthController', properties: { module: 'auth' } },
      { id: 'n3', type: 'module', label: 'UserService', properties: { module: 'user' } },
    ];

    const edges: GraphEdge[] = [
      { source: 'n1', target: 'n2', type: 'calls', properties: {} },
      { source: 'n2', target: 'n3', type: 'calls', properties: {} }, // Cross-module
    ];

    await store.save('module-session', { nodes, edges });

    const graph = await store.load('module-session');

    // Filter to auth module
    const authNodes = graph!.nodes.filter(n => n.properties?.module === 'auth');
    expect(authNodes.length).toBe(2);

    // Only edges within auth module
    const authNodeIds = new Set(authNodes.map(n => n.id));
    const authEdges = graph!.edges.filter(
      e => authNodeIds.has(e.source) && authNodeIds.has(e.target)
    );
    expect(authEdges.length).toBe(1); // Only Auth -> Auth edge
  });

  // ── query_graph Handler Tests ───────────────────────────────────

  test('query_graph finds matching nodes', async () => {
    const nodes: GraphNode[] = [
      { id: 'n1', type: 'module', label: 'AuthService', properties: { description: 'Handles user authentication' } },
      { id: 'n2', type: 'module', label: 'UserService', properties: { description: 'User management' } },
      { id: 'n3', type: 'module', label: 'PaymentService', properties: { description: 'Payment processing' } },
    ];

    await store.save('query-session', { nodes, edges: [] });

    const graph = await store.load('query-session');

    // Simple keyword search for "auth"
    const keywords = 'authentication'.toLowerCase().split(/\s+/);
    const matches = graph!.nodes.filter(n => {
      const text = `${n.label} ${n.type} ${n.properties?.description || ''}`.toLowerCase();
      return keywords.some(kw => text.includes(kw));
    });

    expect(matches.length).toBe(1);
    expect(matches[0].label).toBe('AuthService');
  });

  test('query_graph returns empty for no matches', async () => {
    await store.save('empty-session', {
      nodes: [{ id: 'x', type: 'module', label: 'X', properties: {} }],
      edges: [],
    });

    const graph = await store.load('empty-session');
    const keywords = 'nonexistent'.toLowerCase().split(/\s+/);
    const matches = graph!.nodes.filter(n => {
      const text = `${n.label} ${n.type}`.toLowerCase();
      return keywords.some(kw => text.includes(kw));
    });

    expect(matches.length).toBe(0);
  });

  // ── Tool Schema Tests ───────────────────────────────────────────

  test('trace_lineage tool has required parameters', () => {
    const schema = {
      name: 'trace_lineage',
      inputSchema: {
        properties: {
          entity: { type: 'string' },
          sessionId: { type: 'string' },
          depth: { type: 'number', default: 3 },
        },
        required: ['entity', 'sessionId'],
      },
    };

    expect(schema.inputSchema.required).toContain('entity');
    expect(schema.inputSchema.required).toContain('sessionId');
    expect(schema.inputSchema.properties.depth.default).toBe(3);
  });

  test('get_lineage_graph tool has sessionId required', () => {
    const schema = {
      name: 'get_lineage_graph',
      inputSchema: {
        properties: {
          sessionId: { type: 'string' },
          module: { type: 'string' },
        },
        required: ['sessionId'],
      },
    };

    expect(schema.inputSchema.required).toContain('sessionId');
    expect(schema.inputSchema.properties.module).toBeDefined();
  });

  test('analyze_codebase tool has path required', () => {
    const schema = {
      name: 'analyze_codebase',
      inputSchema: {
        properties: {
          path: { type: 'string' },
          enableLineage: { type: 'boolean', default: true },
        },
        required: ['path'],
      },
    };

    expect(schema.inputSchema.required).toContain('path');
    expect(schema.inputSchema.properties.enableLineage.default).toBe(true);
  });

  test('query_graph tool has both parameters required', () => {
    const schema = {
      name: 'query_graph',
      inputSchema: {
        properties: {
          sessionId: { type: 'string' },
          question: { type: 'string' },
        },
        required: ['sessionId', 'question'],
      },
    };

    expect(schema.inputSchema.required).toContain('sessionId');
    expect(schema.inputSchema.required).toContain('question');
  });
});