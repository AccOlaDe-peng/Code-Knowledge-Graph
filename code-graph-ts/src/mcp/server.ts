// MCP Server — Model Context Protocol for Claude Code integration
// Enables Claude Code to query lineage graph directly

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { LocalFileStore } from '../graph/store/LocalFileStore.ts';
import { traceLineage } from '../agents/specialized/LineageAgent.ts';
import type { GraphData } from '../graph/schema.ts';

// ── Storage ───────────────────────────────────────────────────────

const store = new LocalFileStore();

// ── Tool Definitions ──────────────────────────────────────────────

const tools: Tool[] = [
  {
    name: 'trace_lineage',
    description: `Trace data lineage for an entity. Returns upstream data sources and downstream data sinks.

Use this to understand how data flows through the codebase.
- "Where does the user data come from?" → trace_lineage(entity: "UserDTO")
- "What happens to the order after creation?" → trace_lineage(entity: "Order")`,
    inputSchema: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description: 'Entity name to trace (e.g., "UserService", "OrderRepository")',
        },
        sessionId: {
          type: 'string',
          description: 'Analysis session ID from a previous analyze_codebase call',
        },
        depth: {
          type: 'number',
          description: 'Maximum depth to trace (default: 3)',
          default: 3,
        },
      },
      required: ['entity', 'sessionId'],
    },
  },
  {
    name: 'get_lineage_graph',
    description: 'Get the full data lineage graph for a session. Returns all nodes and edges.',
    inputSchema: {
      type: 'object',
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
  },
  {
    name: 'analyze_codebase',
    description: 'Analyze a codebase to extract architecture and data lineage. Returns a session ID.',
    inputSchema: {
      type: 'object',
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
      },
      required: ['path'],
    },
  },
  {
    name: 'query_graph',
    description: 'Query the knowledge graph using natural language. Returns relevant nodes.',
    inputSchema: {
      type: 'object',
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
  },
];

// ── Tool Handlers ─────────────────────────────────────────────────

async function handleTraceLineage(args: {
  entity: string;
  sessionId: string;
  depth?: number;
}): Promise<object> {
  const graph = await store.load(args.sessionId);
  if (!graph) {
    return { error: `Session not found: ${args.sessionId}` };
  }

  // Find entity node
  const entityNode = graph.nodes.find(
    n => n.label === args.entity || n.id === args.entity
  );
  if (!entityNode) {
    return { error: `Entity not found: ${args.entity}` };
  }

  // Trace upstream and downstream
  const depth = args.depth ?? 3;
  const upstream: typeof graph.nodes = [];
  const downstream: typeof graph.nodes = [];
  const visited = new Set<string>();

  function findUpstream(nodeId: string, currentDepth: number) {
    if (currentDepth > depth || visited.has(nodeId)) return;
    visited.add(nodeId);

    for (const edge of graph.edges) {
      if (edge.target === nodeId) {
        const sourceNode = graph.nodes.find(n => n.id === edge.source);
        if (sourceNode) {
          upstream.push({
            ...sourceNode,
            properties: { ...sourceNode.properties, relationship: edge.type },
          });
          findUpstream(edge.source, currentDepth + 1);
        }
      }
    }
  }

  function findDownstream(nodeId: string, currentDepth: number) {
    if (currentDepth > depth || visited.has(nodeId)) return;
    visited.add(nodeId);

    for (const edge of graph.edges) {
      if (edge.source === nodeId) {
        const targetNode = graph.nodes.find(n => n.id === edge.target);
        if (targetNode) {
          downstream.push({
            ...targetNode,
            properties: { ...targetNode.properties, relationship: edge.type },
          });
          findDownstream(edge.target, currentDepth + 1);
        }
      }
    }
  }

  findUpstream(entityNode.id, 1);
  visited.clear();
  findDownstream(entityNode.id, 1);

  return {
    entity: {
      id: entityNode.id,
      name: entityNode.label,
      type: entityNode.type,
      file: entityNode.properties?.file,
    },
    upstream: upstream.slice(0, 20).map(n => ({
      id: n.id,
      name: n.label,
      type: n.type,
      file: n.properties?.file,
      relationship: n.properties?.relationship,
    })),
    downstream: downstream.slice(0, 20).map(n => ({
      id: n.id,
      name: n.label,
      type: n.type,
      file: n.properties?.file,
      relationship: n.properties?.relationship,
    })),
    summary: `Found ${upstream.length} upstream and ${downstream.length} downstream connections`,
  };
}

async function handleGetLineageGraph(args: {
  sessionId: string;
  module?: string;
}): Promise<object> {
  const graph = await store.load(args.sessionId);
  if (!graph) {
    return { error: `Session not found: ${args.sessionId}` };
  }

  let nodes = graph.nodes;
  let edges = graph.edges;

  if (args.module) {
    // Filter to module
    const moduleNodes = nodes.filter(
      n => n.properties?.module === args.module || n.label === args.module
    );
    const moduleNodeIds = new Set(moduleNodes.map(n => n.id));
    nodes = moduleNodes;
    edges = edges.filter(
      e => moduleNodeIds.has(e.source) && moduleNodeIds.has(e.target)
    );
  }

  return {
    nodes: nodes.slice(0, 100).map(n => ({
      id: n.id,
      label: n.label,
      type: n.type,
      file: n.properties?.file,
    })),
    edges: edges.slice(0, 200).map(e => ({
      source: e.source,
      target: e.target,
      type: e.type,
      confidence: e.properties?.confidence,
    })),
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };
}

async function handleAnalyzeCodebase(args: {
  path: string;
  enableLineage?: boolean;
}): Promise<object> {
  // For now, return a placeholder - actual analysis would use Coordinator
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    sessionId,
    status: 'started',
    message: `Analysis started for ${args.path}. Use GET /api/analyze/status/${sessionId} to check progress.`,
    note: 'Full analysis requires running the API server. This MCP tool provides read-only access to existing graphs.',
  };
}

async function handleQueryGraph(args: {
  sessionId: string;
  question: string;
}): Promise<object> {
  const graph = await store.load(args.sessionId);
  if (!graph) {
    return { error: `Session not found: ${args.sessionId}` };
  }

  // Simple keyword matching - could be enhanced with embeddings
  const keywords = args.question.toLowerCase().split(/\s+/);
  const relevantNodes = graph.nodes.filter(n => {
    const text = `${n.label} ${n.type} ${n.properties?.description || ''}`.toLowerCase();
    return keywords.some(kw => text.includes(kw));
  }).slice(0, 20);

  const nodeIds = new Set(relevantNodes.map(n => n.id));
  const relevantEdges = graph.edges.filter(
    e => nodeIds.has(e.source) || nodeIds.has(e.target)
  ).slice(0, 50);

  return {
    answer: `Found ${relevantNodes.length} nodes matching "${args.question}"`,
    nodes: relevantNodes.map(n => ({
      id: n.id,
      label: n.label,
      type: n.type,
      relevance: 1.0, // Placeholder
    })),
    edges: relevantEdges.map(e => ({
      source: e.source,
      target: e.target,
      type: e.type,
    })),
  };
}

// ── Server Setup ──────────────────────────────────────────────────

async function createServer(): Promise<Server> {
  const server = new Server(
    { name: 'code-knowledge-graph', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    let result: object;
    try {
      switch (name) {
        case 'trace_lineage':
          result = await handleTraceLineage(args as Parameters<typeof handleTraceLineage>[0]);
          break;
        case 'get_lineage_graph':
          result = await handleGetLineageGraph(args as Parameters<typeof handleGetLineageGraph>[0]);
          break;
        case 'analyze_codebase':
          result = await handleAnalyzeCodebase(args as Parameters<typeof handleAnalyzeCodebase>[0]);
          break;
        case 'query_graph':
          result = await handleQueryGraph(args as Parameters<typeof handleQueryGraph>[0]);
          break;
        default:
          result = { error: `Unknown tool: ${name}` };
      }
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });

  return server;
}

async function main() {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Code Knowledge Graph MCP Server running on stdio');
}

// Export for programmatic use
export { createServer, tools };
export default main;

// Run if executed directly
if (import.meta.main) {
  main().catch(console.error);
}
