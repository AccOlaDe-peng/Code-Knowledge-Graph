// GraphStoreTool — graph persistence operations

import { createTool, type ToolResult } from './common.ts';
import type { Tool } from '../BaseAgent.ts';
import type { GraphNode, GraphEdge, GraphData } from '../../graph/schema.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface GraphStoreConfig {
  sessionId: string;
  baseDir?: string;
}

// Tool for saving graph to JSON
function createSaveGraphTool(): Tool {
  return createTool<{ data: GraphData; sessionId: string; basePath?: string }, string>(
    'SaveGraphTool',
    async ({ data, sessionId, basePath }) => {
      const baseDir = basePath ?? path.join(process.env.HOME ?? '/tmp', '.code-graph', 'graphs');
      const filePath = path.join(baseDir, `${sessionId}.json`);

      try {
        await fs.mkdir(baseDir, { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        return { success: true, data: filePath };
      } catch (error) {
        return { success: false, error: `Failed to save graph: ${error}` };
      }
    },
  );
}

// Tool for loading graph from JSON
function createLoadGraphTool(): Tool {
  return createTool<{ sessionId: string; basePath?: string }, GraphData | null>(
    'LoadGraphTool',
    async ({ sessionId, basePath }) => {
      const baseDir = basePath ?? path.join(process.env.HOME ?? '/tmp', '.code-graph', 'graphs');
      const filePath = path.join(baseDir, `${sessionId}.json`);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content) as GraphData;
        return { success: true, data };
      } catch {
        return { success: true, data: null };
      }
    },
  );
}

// Tool for adding nodes to in-memory graph
function createAddNodesTool(graphRef: { nodes: GraphNode[]; edges: GraphEdge[] }): Tool {
  return createTool<GraphNode[], number>('AddNodesTool', async (nodes) => {
    graphRef.nodes.push(...nodes);
    return { success: true, data: nodes.length };
  });
}

// Tool for adding edges to in-memory graph
function createAddEdgesTool(graphRef: { nodes: GraphNode[]; edges: GraphEdge[] }): Tool {
  return createTool<GraphEdge[], number>('AddEdgesTool', async (edges) => {
    graphRef.edges.push(...edges);
    return { success: true, data: edges.length };
  });
}

// Tool for querying nodes by type
function createQueryNodesTool(graphRef: { nodes: GraphNode[]; edges: GraphEdge[] }): Tool {
  return createTool<{ type?: string; file?: string }, GraphNode[]>('QueryNodesTool', async ({ type, file }) => {
    const filtered = graphRef.nodes.filter(n => {
      if (type && n.type !== type) return false;
      if (file && n.file !== file) return false;
      return true;
    });
    return { success: true, data: filtered };
  });
}

// Tool for querying edges
function createQueryEdgesTool(graphRef: { nodes: GraphNode[]; edges: GraphEdge[] }): Tool {
  return createTool<{ source?: string; target?: string; type?: string }, GraphEdge[]>(
    'QueryEdgesTool',
    async ({ source, target, type }) => {
      const filtered = graphRef.edges.filter(e => {
        if (source && e.source !== source) return false;
        if (target && e.target !== target) return false;
        if (type && e.type !== type) return false;
        return true;
      });
      return { success: true, data: filtered };
    },
  );
}

// Unified GraphStoreTool with operation-based API
type GraphStoreOperation =
  | { operation: 'save'; graph: GraphData; basePath?: string }
  | { operation: 'load'; sessionId?: string; basePath?: string }
  | { operation: 'add_nodes'; nodes: GraphNode[] }
  | { operation: 'add_edges'; edges: GraphEdge[] }
  | { operation: 'query'; queryType: 'nodes' | 'edges'; filter?: { type?: string; file?: string; source?: string; target?: string } };

interface GraphStoreResult {
  success: boolean;
  data?: GraphData | GraphNode[] | GraphEdge[] | string | number | null;
  error?: string;
}

let graphStoreInstance: { nodes: GraphNode[]; edges: GraphEdge[] } = { nodes: [], edges: [] };

function createGraphStoreTool(): Tool {
  return createTool<GraphStoreOperation, GraphStoreResult['data']>(
    'GraphStoreTool',
    async (input) => {
      switch (input.operation) {
        case 'save': {
          const baseDir = input.basePath ?? path.join(process.env.HOME ?? '/tmp', '.code-graph', 'graphs');
          const filePath = path.join(baseDir, `${Date.now()}.json`);
          try {
            await fs.mkdir(baseDir, { recursive: true });
            await fs.writeFile(filePath, JSON.stringify(input.graph, null, 2));
            return { success: true, data: filePath };
          } catch (error) {
            return { success: false, error: `Failed to save graph: ${error}` };
          }
        }
        case 'load': {
          const baseDir = input.basePath ?? path.join(process.env.HOME ?? '/tmp', '.code-graph', 'graphs');
          try {
            const files = await fs.readdir(baseDir);
            const latest = files.filter(f => f.endsWith('.json')).sort().pop();
            if (!latest) return { success: true, data: null };
            const content = await fs.readFile(path.join(baseDir, latest), 'utf-8');
            return { success: true, data: JSON.parse(content) as GraphData };
          } catch {
            return { success: true, data: null };
          }
        }
        case 'add_nodes': {
          graphStoreInstance.nodes.push(...input.nodes);
          return { success: true, data: input.nodes.length };
        }
        case 'add_edges': {
          graphStoreInstance.edges.push(...input.edges);
          return { success: true, data: input.edges.length };
        }
        case 'query': {
          if (input.queryType === 'nodes') {
            const filtered = graphStoreInstance.nodes.filter(n => {
              if (input.filter?.type && n.type !== input.filter.type) return false;
              if (input.filter?.file && n.file !== input.filter.file) return false;
              return true;
            });
            return { success: true, data: filtered };
          } else {
            const filtered = graphStoreInstance.edges.filter(e => {
              if (input.filter?.source && e.source !== input.filter.source) return false;
              if (input.filter?.target && e.target !== input.filter.target) return false;
              if (input.filter?.type && e.type !== input.filter.type) return false;
              return true;
            });
            return { success: true, data: filtered };
          }
        }
      }
    },
  );
}

export type { GraphStoreConfig, GraphStoreOperation, GraphStoreResult };
export {
  createSaveGraphTool,
  createLoadGraphTool,
  createAddNodesTool,
  createAddEdgesTool,
  createQueryNodesTool,
  createQueryEdgesTool,
  createGraphStoreTool,
};
