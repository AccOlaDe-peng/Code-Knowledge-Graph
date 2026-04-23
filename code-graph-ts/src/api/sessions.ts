// Session store — in-memory management of analysis sessions

import { Coordinator } from '../coordinator/Coordinator.ts';
import { CostTracker } from '../cost/CostTracker.ts';
import { CacheManager } from '../cache/CacheManager.ts';
import { ScannerAgent, SCANNER_CONFIG } from '../agents/specialized/ScannerAgent.ts';
import { StaticAgent, STATIC_CONFIG } from '../agents/specialized/StaticAgent.ts';
import { SemanticAgent, SEMANTIC_CONFIG } from '../agents/specialized/SemanticAgent.ts';
import { LineageAgent, LINEAGE_CONFIG } from '../agents/specialized/LineageAgent.ts';
import { GraphBuildAgent, GRAPH_BUILD_CONFIG } from '../agents/specialized/GraphBuildAgent.ts';
import { ReportAgent, REPORT_CONFIG } from '../agents/specialized/ReportAgent.ts';
import { createAgentContext } from '../agents/AgentContext.ts';
import type { GraphData } from '../graph/schema.ts';

interface Session {
  id: string;
  coordinator: Coordinator;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: GraphData;
  error?: string;
  startedAt: number;
  completedAt?: number;
  cancelled: boolean;
}

const sessions = new Map<string, Session>();

function createSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function create(path: string, options?: { enableLineage?: boolean; budget?: number }): Session {
  const id = createSessionId();
  const costTracker = new CostTracker(id, options?.budget ?? 10.0);
  const coordinator = new Coordinator(id, costTracker);
  const cache = new CacheManager();

  // Register all agents
  coordinator.registerAgent('ScannerAgent', (name) => {
    const context = createAgentContext(id, path, cache, { getPendingTasks: async () => [], getBlockedTasks: async () => [] });
    return new ScannerAgent(name, context, cache);
  });

  coordinator.registerAgent('StaticAgent', (name) => {
    const context = createAgentContext(id, path, cache, { getPendingTasks: async () => [], getBlockedTasks: async () => [] });
    return new StaticAgent(name, context, [], cache);
  });

  coordinator.registerAgent('SemanticAgent', (name) => {
    const context = createAgentContext(id, path, cache, { getPendingTasks: async () => [], getBlockedTasks: async () => [] });
    return new SemanticAgent(name, context, [], cache);
  });

  coordinator.registerAgent('LineageAgent', (name) => {
    const context = createAgentContext(id, path, cache, { getPendingTasks: async () => [], getBlockedTasks: async () => [] });
    return new LineageAgent(name, context, []);
  });

  coordinator.registerAgent('GraphBuildAgent', (name) => {
    const context = createAgentContext(id, path, cache, { getPendingTasks: async () => [], getBlockedTasks: async () => [] });
    return new GraphBuildAgent(name, context, [], []);
  });

  coordinator.registerAgent('ReportAgent', (name) => {
    const context = createAgentContext(id, path, cache, { getPendingTasks: async () => [], getBlockedTasks: async () => [] });
    return new ReportAgent(name, context, [], []);
  });

  const session: Session = {
    id,
    coordinator,
    status: 'pending',
    startedAt: Date.now(),
    cancelled: false,
  };

  sessions.set(id, session);
  return session;
}

async function startAnalysis(sessionId: string, path: string, options?: { enableLineage?: boolean; budget?: number }): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  session.status = 'running';

  try {
    const result = await session.coordinator.analyze({
      path,
      enableLineage: options?.enableLineage,
      budget: options?.budget,
    });

    if (session.cancelled) {
      session.status = 'cancelled';
    } else {
      session.result = result;
      session.status = 'completed';
    }
    session.completedAt = Date.now();
  } catch (error) {
    session.status = 'failed';
    session.error = error instanceof Error ? error.message : String(error);
    session.completedAt = Date.now();
  }
}

function get(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

function cancel(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  session.cancelled = true;
  if (session.status === 'pending') {
    session.status = 'cancelled';
  }
  return true;
}

function list(): Pick<Session, 'id' | 'status' | 'startedAt' | 'completedAt'>[] {
  return [...sessions.values()].map(({ id, status, startedAt, completedAt }) => ({
    id,
    status,
    startedAt,
    completedAt,
  }));
}

function cleanup(maxAge: number = 24 * 60 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.completedAt && now - session.completedAt > maxAge) {
      sessions.delete(id);
    }
  }
}

export type { Session };
export { create, startAnalysis, get, cancel, list, cleanup };
