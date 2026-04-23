// Coordinator type definitions

import type { GraphNode, GraphEdge, Confidence } from '../graph/schema.ts';

// ── Agent Configuration ─────────────────────────────────

interface AgentConfig {
  name: string;
  description: string;
  tools: string[];  // Explicit list, no wildcards
  disallowedTools?: string[];
  model?: 'opus' | 'sonnet' | 'haiku';
  maxConcurrency?: number;
}

// ── Agent Result ────────────────────────────────────────

interface AgentResult {
  agentId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    confidence: Confidence;
    source: 'ast' | 'semantic' | 'lineage' | 'graph-build' | 'report';
    filesProcessed: string[];
    tokensUsed?: number;
  };
}

// ── Task ────────────────────────────────────────────────

interface Task {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  agentId?: string;
  result?: AgentResult;
  error?: string;
  blockedBy?: string[];
}

// ── Message ─────────────────────────────────────────────

interface Message {
  type: 'task_result' | 'progress' | 'error' | 'query' | 'response';
  fromAgentId: string;
  toAgentId: string | 'coordinator' | 'broadcast';
  payload: unknown;
  timestamp: number;
}

// ── Analysis Request ────────────────────────────────────

interface AnalyzeRequest {
  path: string;
  update?: boolean;
  enableLineage?: boolean;
  languages?: string[];
  budget?: number;
}

// ── Analysis Conditions ─────────────────────────────────

type AnalysisMode = 'full' | 'incremental' | 'static-only' | 'pure-code';

interface AnalysisDecision {
  mode: AnalysisMode;
  agents: string[];
  reason: string;
}

export type {
  AgentConfig,
  AgentResult,
  Task,
  Message,
  AnalyzeRequest,
  AnalysisMode,
  AnalysisDecision,
};
