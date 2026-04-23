// Graph data routes — full graph, filtered views, stats

import type { FastifyInstance } from 'fastify';
import { get } from '../sessions.ts';
import {
  ARCHITECTURE_NODE_TYPES,
  STRUCTURAL_EDGE_TYPES,
  LINEAGE_EDGE_TYPES,
} from '../../graph/schema.ts';
import type { GraphNode, GraphEdge } from '../../graph/schema.ts';

export async function graphRoutes(app: FastifyInstance): Promise<void> {
  // Full graph
  app.get<{ Params: { sessionId: string } }>('/graph/:sessionId', async (request, reply) => {
    const session = get(request.params.sessionId);
    if (!session) {
      reply.code(404);
      return { error: `Session not found: ${request.params.sessionId}` };
    }
    if (!session.result) {
      reply.code(202);
      return { error: 'Analysis not yet complete', status: session.status };
    }

    return session.result;
  });

  // Architecture view — high-level nodes only
  app.get<{ Params: { sessionId: string } }>('/graph/:sessionId/framework', async (request, reply) => {
    const session = get(request.params.sessionId);
    if (!session) {
      reply.code(404);
      return { error: `Session not found: ${request.params.sessionId}` };
    }
    if (!session.result) {
      reply.code(202);
      return { error: 'Analysis not yet complete', status: session.status };
    }

    const nodes = session.result.nodes.filter(n => ARCHITECTURE_NODE_TYPES.has(n.type));
    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = session.result.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

    return { nodes, edges };
  });

  // Call graph — calls + imports edges
  app.get<{ Params: { sessionId: string } }>('/graph/:sessionId/call', async (request, reply) => {
    const session = get(request.params.sessionId);
    if (!session) {
      reply.code(404);
      return { error: `Session not found: ${request.params.sessionId}` };
    }
    if (!session.result) {
      reply.code(202);
      return { error: 'Analysis not yet complete', status: session.status };
    }

    const callEdgeTypes = new Set(['calls', 'imports', 'async_calls']);
    const edges = session.result.edges.filter(e => callEdgeTypes.has(e.type));
    const nodeIds = new Set([...edges.map(e => e.source), ...edges.map(e => e.target)]);
    const nodes = session.result.nodes.filter(n => nodeIds.has(n.id));

    return { nodes, edges };
  });

  // Data lineage view
  app.get<{ Params: { sessionId: string } }>('/graph/:sessionId/lineage', async (request, reply) => {
    const session = get(request.params.sessionId);
    if (!session) {
      reply.code(404);
      return { error: `Session not found: ${request.params.sessionId}` };
    }
    if (!session.result) {
      reply.code(202);
      return { error: 'Analysis not yet complete', status: session.status };
    }

    const edges = session.result.edges.filter(e => LINEAGE_EDGE_TYPES.has(e.type as any));
    const nodeIds = new Set([...edges.map(e => e.source), ...edges.map(e => e.target)]);
    const nodes = session.result.nodes.filter(n => nodeIds.has(n.id));

    return { nodes, edges };
  });

  // Graph statistics
  app.get<{ Params: { sessionId: string } }>('/graph/:sessionId/stats', async (request, reply) => {
    const session = get(request.params.sessionId);
    if (!session) {
      reply.code(404);
      return { error: `Session not found: ${request.params.sessionId}` };
    }
    if (!session.result) {
      reply.code(202);
      return { error: 'Analysis not yet complete', status: session.status };
    }

    const nodeTypes: Record<string, number> = {};
    const edgeTypes: Record<string, number> = {};

    for (const node of session.result.nodes) {
      nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
    }
    for (const edge of session.result.edges) {
      edgeTypes[edge.type] = (edgeTypes[edge.type] ?? 0) + 1;
    }

    return {
      totalNodes: session.result.nodes.length,
      totalEdges: session.result.edges.length,
      nodeTypes,
      edgeTypes,
    };
  });
}
