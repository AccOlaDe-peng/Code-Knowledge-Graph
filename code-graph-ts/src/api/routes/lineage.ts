// Lineage API routes — data lineage endpoints

import type { FastifyPluginAsync } from 'fastify';
import { Confidence } from '../../graph/schema.ts';
import type { GraphNode, GraphEdge } from '../../graph/schema.ts';

// API error response format (per design doc)
interface ApiErrorResponse {
  error: string;
  code: string;
  details?: unknown;
}

// Module-level lineage response
interface ModulesResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    moduleCount: number;
    serviceCount: number;
    edgeCount: number;
  };
}

// Entity-level lineage response
interface EntityResponse {
  entity: GraphNode;
  upstream: GraphNode[];
  downstream: GraphNode[];
  edges: GraphEdge[];
}

// Error codes
const ErrorCodes = {
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  ENTITY_NOT_FOUND: 'ENTITY_NOT_FOUND',
  INVALID_PARAMS: 'INVALID_PARAMS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

// In-memory session storage (will be replaced by proper session manager)
const sessions = new Map<string, {
  nodes: GraphNode[];
  edges: GraphEdge[];
  createdAt: Date;
}>();

export const lineageRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/lineage/:sessionId/modules
  // Returns module-level data lineage graph
  app.get<{ Params: { sessionId: string }; Querystring: { module?: string } }>(
    '/lineage/:sessionId/modules',
    async (request, reply) => {
      const { sessionId } = request.params;
      const { module } = request.query;

      const session = sessions.get(sessionId);
      if (!session) {
        return reply.status(404).send({
          error: `Session ${sessionId} not found`,
          code: ErrorCodes.SESSION_NOT_FOUND,
        } as ApiErrorResponse);
      }

      // Filter edges by lineage types
      const lineageEdges = session.edges.filter(e =>
        e.type === 'flow_to' ||
        e.type === 'reads' ||
        e.type === 'writes' ||
        e.type === 'queries' ||
        e.type === 'transforms'
      );

      // Filter by module if specified
      const filteredEdges = module
        ? lineageEdges.filter(e => {
            const sourceNode = session.nodes.find(n => n.id === e.source);
            const targetNode = session.nodes.find(n => n.id === e.target);
            return sourceNode?.file?.includes(module) || targetNode?.file?.includes(module);
          })
        : lineageEdges;

      // Get unique nodes involved in lineage edges
      const nodeIds = new Set<string>();
      filteredEdges.forEach(e => {
        nodeIds.add(e.source);
        nodeIds.add(e.target);
      });
      const lineageNodes = session.nodes.filter(n => nodeIds.has(n.id));

      // Stats
      const moduleCount = lineageNodes.filter(n => n.type === 'Module').length;
      const serviceCount = lineageNodes.filter(n => n.type === 'Service' || n.type === 'Repository').length;

      return reply.send({
        nodes: lineageNodes,
        edges: filteredEdges,
        stats: {
          moduleCount,
          serviceCount,
          edgeCount: filteredEdges.length,
        },
      } as ModulesResponse);
    }
  );

  // GET /api/lineage/:sessionId/entity/:entityId
  // Returns entity-level lineage (upstream sources + downstream sinks)
  app.get<{ Params: { sessionId: string; entityId: string } }>(
    '/lineage/:sessionId/entity/:entityId',
    async (request, reply) => {
      const { sessionId, entityId } = request.params;

      const session = sessions.get(sessionId);
      if (!session) {
        return reply.status(404).send({
          error: `Session ${sessionId} not found`,
          code: ErrorCodes.SESSION_NOT_FOUND,
        } as ApiErrorResponse);
      }

      const entity = session.nodes.find(n => n.id === entityId);
      if (!entity) {
        return reply.status(404).send({
          error: `Entity ${entityId} not found in session ${sessionId}`,
          code: ErrorCodes.ENTITY_NOT_FOUND,
        } as ApiErrorResponse);
      }

      // Find upstream nodes (data sources flowing to this entity)
      const upstreamEdges = session.edges.filter(e =>
        e.target === entityId &&
        (e.type === 'flow_to' || e.type === 'reads' || e.type === 'queries')
      );
      const upstreamIds = new Set(upstreamEdges.map(e => e.source));
      const upstream = session.nodes.filter(n => upstreamIds.has(n.id));

      // Find downstream nodes (data sinks receiving from this entity)
      const downstreamEdges = session.edges.filter(e =>
        e.source === entityId &&
        (e.type === 'flow_to' || e.type === 'writes' || e.type === 'transforms')
      );
      const downstreamIds = new Set(downstreamEdges.map(e => e.target));
      const downstream = session.nodes.filter(n => downstreamIds.has(n.id));

      // All edges involving this entity
      const edges = session.edges.filter(e => e.source === entityId || e.target === entityId);

      return reply.send({
        entity,
        upstream,
        downstream,
        edges,
      } as EntityResponse);
    }
  );

  // POST /api/lineage/session
  // Create a new lineage session (for testing)
  app.post<{ Body: { nodes: GraphNode[]; edges: GraphEdge[] } }>(
    '/lineage/session',
    async (request, reply) => {
      const { nodes, edges } = request.body;

      if (!nodes || !edges) {
        return reply.status(400).send({
          error: 'Missing nodes or edges in request body',
          code: ErrorCodes.INVALID_PARAMS,
        } as ApiErrorResponse);
      }

      const sessionId = `lineage-${Date.now()}`;
      sessions.set(sessionId, {
        nodes,
        edges,
        createdAt: new Date(),
      });

      return reply.status(201).send({
        sessionId,
        status: 'created',
      });
    }
  );

  // GET /api/lineage/session/:sessionId
  // Get session status
  app.get<{ Params: { sessionId: string } }>(
    '/lineage/session/:sessionId',
    async (request, reply) => {
      const { sessionId } = request.params;

      const session = sessions.get(sessionId);
      if (!session) {
        return reply.status(404).send({
          error: `Session ${sessionId} not found`,
          code: ErrorCodes.SESSION_NOT_FOUND,
        } as ApiErrorResponse);
      }

      return reply.send({
        sessionId,
        status: 'active',
        nodeCount: session.nodes.length,
        edgeCount: session.edges.length,
        createdAt: session.createdAt.toISOString(),
      });
    }
  );

  // DELETE /api/lineage/session/:sessionId
  // Delete a session
  app.delete<{ Params: { sessionId: string } }>(
    '/lineage/session/:sessionId',
    async (request, reply) => {
      const { sessionId } = request.params;

      if (!sessions.has(sessionId)) {
        return reply.status(404).send({
          error: `Session ${sessionId} not found`,
          code: ErrorCodes.SESSION_NOT_FOUND,
        } as ApiErrorResponse);
      }

      sessions.delete(sessionId);
      return reply.status(204).send();
    }
  );
};

export default lineageRoutes;