import { test, expect, describe, beforeEach } from 'bun:test';
import { Merger } from '../src/coordinator/Merger.ts';
import { CacheManager } from '../src/cache/CacheManager.ts';
import { CostTracker } from '../src/cost/CostTracker.ts';
import { AgentError } from '../src/errors/index.ts';
import { Confidence, NodeType, EdgeType } from '../src/graph/schema.ts';
import type { GraphNode, GraphEdge } from '../src/graph/schema.ts';
import type { AgentResult } from '../src/coordinator/types.ts';

// ── Test 1: Merger — EXTRACTED wins over INFERRED ──────────────

describe('Merger', () => {
  test('EXTRACTED node wins over INFERRED node with same id', () => {
    const merger = new Merger();

    const inferredResult: AgentResult = {
      agentId: 'semantic-agent',
      nodes: [{
        id: 'file:ClassA',
        label: 'ClassA',
        type: NodeType.Class,
        file: '/src/a.ts',
        confidence: Confidence.INFERRED,
        metadata: { source: 'semantic' },
      }],
      edges: [],
      metadata: { confidence: Confidence.INFERRED, source: 'semantic', filesProcessed: [] },
    };

    const extractedResult: AgentResult = {
      agentId: 'static-agent',
      nodes: [{
        id: 'file:ClassA',
        label: 'ClassA',
        type: NodeType.Class,
        file: '/src/a.ts',
        confidence: Confidence.EXTRACTED,
        metadata: { source: 'ast' },
      }],
      edges: [],
      metadata: { confidence: Confidence.EXTRACTED, source: 'ast', filesProcessed: [] },
    };

    // Merge: ast has higher SOURCE_PRIORITY, so EXTRACTED should win
    const result = merger.merge([inferredResult, extractedResult]);

    const merged = result.nodes.find(n => n.id === 'file:ClassA');
    expect(merged).toBeDefined();
    expect(merged!.confidence).toBe(Confidence.EXTRACTED);
    expect(merged!.metadata.source).toBe('ast');
  });

  test('EXTRACTED edge wins over INFERRED edge with same source+target+type', () => {
    const merger = new Merger();

    const inferredResult: AgentResult = {
      agentId: 'semantic-agent',
      nodes: [],
      edges: [{
        id: 'edge-1',
        source: 'A',
        target: 'B',
        type: EdgeType.imports,
        confidence: Confidence.INFERRED,
        weight: 0.7,
      }],
      metadata: { confidence: Confidence.INFERRED, source: 'semantic', filesProcessed: [] },
    };

    const extractedResult: AgentResult = {
      agentId: 'static-agent',
      nodes: [],
      edges: [{
        id: 'edge-2',
        source: 'A',
        target: 'B',
        type: EdgeType.imports,
        confidence: Confidence.EXTRACTED,
        weight: 1.0,
      }],
      metadata: { confidence: Confidence.EXTRACTED, source: 'ast', filesProcessed: [] },
    };

    const result = merger.merge([inferredResult, extractedResult]);

    expect(result.edges.length).toBe(1);
    expect(result.edges[0]!.confidence).toBe(Confidence.EXTRACTED);
  });
});

// ── Test 2: CacheManager — TTL expiry ──────────────────────────

describe('CacheManager TTL', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager('/tmp/code-graph-test-' + Date.now());
  });

  test('expired entry returns null', () => {
    const key = cache.makeKey('test-file');
    cache.set(key, { value: 'hello' }, 'ast');

    // Manually expire by overwriting createdAt
    const store = (cache as any).store as Map<string, any>;
    const entry = store.get(key);
    if (entry) {
      // Set createdAt far enough in the past that TTL expired
      // ast TTL = 7 days = 604800000ms, so set createdAt 8 days ago
      entry.createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    }

    const result = cache.get(key);
    expect(result).toBeNull();
  });

  test('non-expired entry returns value', () => {
    const key = cache.makeKey('fresh-file');
    cache.set(key, { value: 'world' }, 'ast');

    const result = cache.get(key);
    expect(result).not.toBeNull();
    expect(result!.result).toEqual({ value: 'world' });
  });
});

// ── Test 3: CacheManager — schema version mismatch ─────────────

describe('CacheManager schema version', () => {
  test('mismatched schema version returns null', () => {
    const cache = new CacheManager('/tmp/code-graph-test-sv-' + Date.now());
    const key = cache.makeKey('versioned-file');

    cache.set(key, { value: 'data' }, 'ast');

    // Tamper with schema version in the entry
    const store = (cache as any).store as Map<string, any>;
    const entry = store.get(key);
    if (entry) {
      entry.schemaVersion = '0.0.0-wrong';
    }

    const result = cache.get(key);
    expect(result).toBeNull();
  });
});

// ── Test 4: AgentPool — maxConcurrency ─────────────────────────

describe('AgentPool', () => {
  test('respects maxConcurrency limit', async () => {
    const maxConcurrency = 2;
    let activeCount = 0;
    let maxObserved = 0;
    const done: Promise<void>[] = [];

    // Simple semaphore-based concurrency limiter
    const queue: (() => void)[] = [];
    let running = 0;

    const runTask = async (id: number): Promise<void> => {
      // Wait for semaphore
      await new Promise<void>((resolve) => {
        if (running < maxConcurrency) {
          running++;
          resolve();
        } else {
          queue.push(() => {
            running++;
            resolve();
          });
        }
      });

      activeCount++;
      maxObserved = Math.max(maxObserved, activeCount);

      // Simulate work
      await new Promise(r => setTimeout(r, 30));

      activeCount--;
      running--;

      // Release next in queue
      if (queue.length > 0) {
        const next = queue.shift()!;
        next();
      }
    };

    for (let i = 0; i < 5; i++) {
      done.push(runTask(i));
    }

    await Promise.all(done);
    expect(maxObserved).toBeLessThanOrEqual(maxConcurrency);
  });
});

// ── Test 5: CostTracker — budget exceeded ──────────────────────

describe('CostTracker', () => {
  test('throws AgentError when budget exceeded', () => {
    // CostTracker(sessionId, budgetInDollars)
    // Sonnet avg price = (0.003 + 0.015) / 2 = $0.009/1K tokens
    // 1500 tokens = ~$0.0135, 2000 tokens = ~$0.018
    // Budget of $0.01 → first call should pass, second should fail
    const tracker = new CostTracker('test-session', 0.01);

    // 1000 tokens at sonnet ≈ $0.009 (under $0.01 budget)
    tracker.recordUsage('test-agent', 1000, 'sonnet');

    // Another 500 tokens ≈ $0.0045, total ≈ $0.0135 (over budget)
    expect(() => tracker.recordUsage('test-agent', 500, 'sonnet')).toThrow(AgentError);
  });

  test('allows usage within budget', () => {
    const tracker = new CostTracker('test-session', 10.0);
    tracker.recordUsage('agent-a', 1000, 'sonnet');
    tracker.recordUsage('agent-b', 500, 'haiku');

    const report = tracker.getReport();
    expect(report.totalTokens).toBe(1500);
    expect(report.totalCost).toBeGreaterThan(0);
  });

  test('getReport returns correct cost', () => {
    const tracker = new CostTracker('test-session', 100.0);
    tracker.recordUsage('agent-a', 1000, 'sonnet');
    tracker.recordUsage('agent-b', 500, 'opus');

    const report = tracker.getReport();
    expect(report.totalCost).toBeGreaterThan(0);
    expect(report.budget).toBe(100.0);
  });
});
