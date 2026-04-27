// MCP Tool Definitions for Code Knowledge Graph
// These schemas define the tools available to Claude Code via MCP

// ── trace_lineage Tool ─────────────────────────────────────

export const trace_lineage = {
  name: 'trace_lineage',
  description: `Trace data lineage for an entity. Returns upstream data sources
and downstream data sinks. Use this to understand how data flows through the codebase.

Example questions this answers:
- "Where does the user data come from?"
- "What happens to the order after it's created?"
- "Which services read from the payment database?"`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      entity: {
        type: 'string',
        description: 'Entity name to trace (e.g., "UserService", "OrderRepository", "PaymentDTO")',
      },
      sessionId: {
        type: 'string',
        description: 'Analysis session ID from a previous analyze call',
      },
      depth: {
        type: 'number',
        description: 'Maximum depth to trace (default: 3)',
        default: 3,
      },
    },
    required: ['entity', 'sessionId'],
  },
};

// ── get_lineage_graph Tool ─────────────────────────────────

export const get_lineage_graph = {
  name: 'get_lineage_graph',
  description: `Get the full data lineage graph for a session. Returns all nodes
and edges representing data flow relationships.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      sessionId: {
        type: 'string',
        description: 'Analysis session ID',
      },
      module: {
        type: 'string',
        description: 'Optional: filter to a specific module',
      },
    },
    required: ['sessionId'],
  },
};

// ── analyze_codebase Tool ───────────────────────────────────

export const analyze_codebase = {
  name: 'analyze_codebase',
  description: `Analyze a codebase to extract architecture, dependencies, and data lineage.
Returns a session ID that can be used with other tools.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Path to the codebase to analyze',
      },
      enableLineage: {
        type: 'boolean',
        description: 'Enable data lineage extraction (default: true)',
        default: true,
      },
      languages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Languages to analyze (e.g., ["java", "typescript"])',
      },
    },
    required: ['path'],
  },
};

// ── query_graph Tool ────────────────────────────────────────

export const query_graph = {
  name: 'query_graph',
  description: `Query the knowledge graph using natural language. Returns relevant
nodes and their relationships.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      sessionId: {
        type: 'string',
        description: 'Analysis session ID',
      },
      question: {
        type: 'string',
        description: 'Natural language question about the codebase',
      },
    },
    required: ['sessionId', 'question'],
  },
};

// ── All MCP Tools ───────────────────────────────────────────

export const MCP_TOOLS = [
  trace_lineage,
  get_lineage_graph,
  analyze_codebase,
  query_graph,
] as const;

// ── Tool Response Types ─────────────────────────────────────

export interface TraceLineageResponse {
  entity: {
    id: string;
    name: string;
    type: string;
    file: string;
  };
  upstream: Array<{
    id: string;
    name: string;
    type: string;
    file: string;
    relationship: string;
  }>;
  downstream: Array<{
    id: string;
    name: string;
    type: string;
    file: string;
    relationship: string;
  }>;
  summary: string;
}

export interface GetLineageGraphResponse {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    file?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: string;
    confidence: string;
  }>;
  stats: {
    nodeCount: number;
    edgeCount: number;
  };
}

export interface AnalyzeCodebaseResponse {
  sessionId: string;
  status: 'started' | 'running' | 'completed' | 'failed';
  message: string;
}

export interface QueryGraphResponse {
  answer: string;
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    relevance: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: string;
  }>;
}

export default MCP_TOOLS;
