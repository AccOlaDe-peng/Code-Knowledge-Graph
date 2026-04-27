// Frontend-compatible routes — matches Python backend API
// These routes don't have /api prefix for backward compatibility

import type { FastifyPluginAsync } from 'fastify';
import { get } from '../sessions.ts';
import { LocalFileStore } from '../../graph/store/LocalFileStore.ts';
import {
  ARCHITECTURE_NODE_TYPES,
  LINEAGE_EDGE_TYPES,
} from '../../graph/schema.ts';
import type { GraphNode, GraphEdge } from '../../graph/schema.ts';

const store = new LocalFileStore();

export const frontendRoutes: FastifyPluginAsync = async (app) => {
  // GET /graph/framework — architecture view
  app.get<{ Querystring: { repo_id?: string; node_types?: string } }>(
    '/graph/framework',
    async (request, reply) => {
      const { repo_id, node_types } = request.query;
      const sessionId = repo_id ?? 'unknown';

      // Try in-memory first
      const session = get(sessionId);
      if (session?.result) {
        const nodes = session.result.nodes.filter(n =>
          ARCHITECTURE_NODE_TYPES.has(n.type) ||
          node_types === 'all'
        );
        const nodeIds = new Set(nodes.map(n => n.id));
        const edges = session.result.edges.filter(e =>
          nodeIds.has(e.source) && nodeIds.has(e.target)
        );

        return {
          repo_id: sessionId,
          node_count: nodes.length,
          edge_count: edges.length,
          nodes: nodes.map(n => ({
            id: n.id,
            type: n.type.toLowerCase(),
            name: n.label,
            properties: n.properties,
          })),
          edges: edges.map(e => ({
            from: e.source,
            to: e.target,
            type: e.type,
            properties: e.properties,
          })),
        };
      }

      // Try persisted
      const graph = await store.load(sessionId);
      if (graph) {
        const nodes = graph.nodes.filter(n =>
          ARCHITECTURE_NODE_TYPES.has(n.type) ||
          node_types === 'all'
        );
        const nodeIds = new Set(nodes.map(n => n.id));
        const edges = graph.edges.filter(e =>
          nodeIds.has(e.source) && nodeIds.has(e.target)
        );

        return {
          repo_id: sessionId,
          node_count: nodes.length,
          edge_count: edges.length,
          nodes: nodes.map(n => ({
            id: n.id,
            type: n.type.toLowerCase(),
            name: n.label,
            properties: n.properties,
          })),
          edges: edges.map(e => ({
            from: e.source,
            to: e.target,
            type: e.type,
            properties: e.properties,
          })),
        };
      }

      reply.code(404);
      return { detail: `Graph not found: ${sessionId}` };
    }
  );

  // GET /graph/lineage — data lineage view
  app.get<{ Querystring: { repo_id?: string; edge_types?: string; node_id?: string; depth?: number; direction?: string } }>(
    '/graph/lineage',
    async (request, reply) => {
      const { repo_id, edge_types, node_id, depth, direction } = request.query;
      const sessionId = repo_id ?? 'unknown';

      const graph = await store.load(sessionId);
      if (!graph) {
        const session = get(sessionId);
        if (!session?.result) {
          reply.code(404);
          return { detail: `Graph not found: ${sessionId}` };
        }
      }

      const nodes = graph?.nodes ?? session?.result?.nodes ?? [];
      const edges = graph?.edges ?? session?.result?.edges ?? [];

      // Filter by lineage edge types
      const lineageEdges = edges.filter(e =>
        LINEAGE_EDGE_TYPES.has(e.type as any) ||
        e.type === 'flow_to' ||
        e.type === 'reads' ||
        e.type === 'writes'
      );

      // If node_id specified, expand from that node
      if (node_id) {
        const maxDepth = depth ?? 3;
        const visited = new Set<string>();
        const resultNodes: GraphNode[] = [];
        const resultEdges: GraphEdge[] = [];

        function expand(nodeId: string, currentDepth: number) {
          if (currentDepth > maxDepth || visited.has(nodeId)) return;
          visited.add(nodeId);

          const node = nodes.find(n => n.id === nodeId);
          if (node) resultNodes.push(node);

          for (const edge of lineageEdges) {
            if (direction === 'upstream' || !direction) {
              if (edge.target === nodeId && !visited.has(edge.source)) {
                resultEdges.push(edge);
                expand(edge.source, currentDepth + 1);
              }
            }
            if (direction === 'downstream' || !direction) {
              if (edge.source === nodeId && !visited.has(edge.target)) {
                resultEdges.push(edge);
                expand(edge.target, currentDepth + 1);
              }
            }
          }
        }

        expand(node_id, 1);

        return {
          repo_id: sessionId,
          edge_types: edge_types ? edge_types.split(',') : ['flow_to', 'reads', 'writes'],
          direction,
          node_count: resultNodes.length,
          edge_count: resultEdges.length,
          nodes: resultNodes.map(n => ({
            id: n.id,
            type: n.type.toLowerCase(),
            name: n.label,
            properties: n.properties,
          })),
          edges: resultEdges.map(e => ({
            from: e.source,
            to: e.target,
            type: e.type,
            properties: e.properties,
          })),
        };
      }

      return {
        repo_id: sessionId,
        edge_types: edge_types ? edge_types.split(',') : ['flow_to', 'reads', 'writes'],
        node_count: nodes.length,
        edge_count: lineageEdges.length,
        nodes: nodes.map(n => ({
          id: n.id,
          type: n.type.toLowerCase(),
          name: n.label,
          properties: n.properties,
        })),
        edges: lineageEdges.map(e => ({
          from: e.source,
          to: e.target,
          type: e.type,
          properties: e.properties,
        })),
      };
    }
  );

  // GET /graph/lineage/modules — module-level lineage
  app.get<{ Querystring: { repo_id?: string } }>(
    '/graph/lineage/modules',
    async (request, reply) => {
      const { repo_id } = request.query;
      const sessionId = repo_id ?? 'unknown';

      const graph = await store.load(sessionId);
      if (!graph) {
        const session = get(sessionId);
        if (!session?.result) {
          reply.code(404);
          return { detail: `Graph not found: ${sessionId}` };
        }
      }

      const nodes = graph?.nodes ?? session?.result?.nodes ?? [];
      const edges = graph?.edges ?? session?.result?.edges ?? [];

      // Group nodes by module (based on file path or properties.module)
      const modules = new Map<string, {
        id: string;
        name: string;
        nodes: GraphNode[];
      }>();

      for (const node of nodes) {
        const moduleId = node.properties?.module ?? node.properties?.file ?? node.id;
        const moduleName = moduleId.split('/').pop()?.split('.')[0] ?? moduleId;

        if (!modules.has(moduleId)) {
          modules.set(moduleId, { id: moduleId, name: moduleName, nodes: [] });
        }
        modules.get(moduleId)!.nodes.push(node);
      }

      // Count services, controllers, repositories per module
      const moduleList = [...modules.values()].map(m => ({
        id: m.id,
        name: m.name,
        service_count: m.nodes.filter(n => n.type === 'Service' || n.type === 'service').length,
        controller_count: m.nodes.filter(n => n.type === 'Controller' || n.type === 'controller').length,
        repository_count: m.nodes.filter(n => n.type === 'Repository' || n.type === 'repository').length,
        cross_module_calls: 0,
        services: m.nodes.filter(n => n.type === 'Service' || n.type === 'service').map(n => ({ id: n.id, name: n.label })),
        controllers: m.nodes.filter(n => n.type === 'Controller' || n.type === 'controller').map(n => ({ id: n.id, name: n.label })),
        repositories: m.nodes.filter(n => n.type === 'Repository' || n.type === 'repository').map(n => ({ id: n.id, name: n.label })),
        databases: [],
      }));

      // Build module edges (calls between modules)
      const moduleEdges: Array<{
        from: string;
        to: string;
        type: string;
        call_count: number;
      }> = [];

      const moduleNodeMap = new Map<string, string>();
      for (const node of nodes) {
        const moduleId = node.properties?.module ?? node.properties?.file ?? node.id;
        moduleNodeMap.set(node.id, moduleId);
      }

      const moduleEdgeCounts = new Map<string, number>();
      for (const edge of edges) {
        const sourceModule = moduleNodeMap.get(edge.source);
        const targetModule = moduleNodeMap.get(edge.target);
        if (sourceModule && targetModule && sourceModule !== targetModule) {
          const key = `${sourceModule}:${targetModule}`;
          moduleEdgeCounts.set(key, (moduleEdgeCounts.get(key) ?? 0) + 1);
        }
      }

      for (const [key, count] of moduleEdgeCounts) {
        const [from, to] = key.split(':');
        moduleEdges.push({ from, to, type: 'cross_module_call', call_count: count });
      }

      return {
        repo_id: sessionId,
        module_count: modules.size,
        edge_count: moduleEdges.length,
        modules: moduleList,
        edges: moduleEdges,
      };
    }
  );

  // GET /services — service nodes
  app.get<{ Querystring: { graph_id?: string } }>(
    '/services',
    async (request, reply) => {
      const { graph_id } = request.query;
      const sessionId = graph_id ?? 'unknown';

      const graph = await store.load(sessionId);
      if (!graph) {
        const session = get(sessionId);
        if (!session?.result) {
          reply.code(404);
          return { detail: `Graph not found: ${sessionId}` };
        }
      }

      const nodes = graph?.nodes ?? session?.result?.nodes ?? [];
      const edges = graph?.edges ?? session?.result?.edges ?? [];

      const serviceTypes = new Set(['service', 'cluster', 'database', 'Service', 'Cluster', 'Database']);
      const serviceNodes = nodes.filter(n => serviceTypes.has(n.type));
      const serviceNodeIds = new Set(serviceNodes.map(n => n.id));
      const serviceEdges = edges.filter(e =>
        serviceNodeIds.has(e.source) && serviceNodeIds.has(e.target)
      );

      return {
        graph_id: sessionId,
        nodes: serviceNodes.map(n => ({
          id: n.id,
          type: n.type.toLowerCase(),
          name: n.label,
          properties: n.properties,
        })),
        edges: serviceEdges.map(e => ({
          from: e.source,
          to: e.target,
          type: e.type,
          properties: e.properties,
        })),
      };
    }
  );

  // GET /graph/function-call — function call graph
  app.get<{ Querystring: { repo_id?: string } }>(
    '/graph/function-call',
    async (request, reply) => {
      const { repo_id } = request.query;
      const sessionId = repo_id ?? 'unknown';

      const graph = await store.load(sessionId);
      if (!graph) {
        const session = get(sessionId);
        if (!session?.result) {
          reply.code(404);
          return { detail: `Graph not found: ${sessionId}` };
        }
      }

      const nodes = graph?.nodes ?? session?.result?.nodes ?? [];
      const edges = graph?.edges ?? session?.result?.edges ?? [];

      const callTypes = new Set(['calls', 'async_calls', 'imports']);
      const callEdges = edges.filter(e => callTypes.has(e.type));
      const nodeIds = new Set([...callEdges.map(e => e.source), ...callEdges.map(e => e.target)]);
      const callNodes = nodes.filter(n => nodeIds.has(n.id));

      return {
        repo_id: sessionId,
        node_count: callNodes.length,
        edge_count: callEdges.length,
        nodes: callNodes.map(n => ({
          id: n.id,
          type: n.type.toLowerCase(),
          name: n.label,
          file: n.properties?.file,
          line: n.properties?.line,
          properties: n.properties,
        })),
        edges: callEdges.map(e => ({
          from: e.source,
          to: e.target,
          type: e.type,
          properties: e.properties,
        })),
      };
    }
  );

  // POST /analyze/repository — async analysis (frontend compatible)
  app.post<{ Body: { repoPath?: string; repoName?: string; branch?: string; languages?: string[] } }>(
    '/analyze/repository',
    async (request, reply) => {
      const { repoPath } = request.body;

      if (!repoPath) {
        reply.code(400);
        return { detail: 'repoPath is required' };
      }

      // Use existing analyze route logic
      const { create, startAnalysis } = await import('../sessions.ts');
      const session = create(repoPath, { enableLineage: true });

      startAnalysis(session.id, repoPath, { enableLineage: true }).catch(() => {});

      reply.code(202);
      return {
        task_id: session.id,
        status: 'pending',
      };
    }
  );

  // GET /analyze/status/:taskId — status check (frontend compatible)
  app.get<{ Params: { taskId: string } }>(
    '/analyze/status/:taskId',
    async (request, reply) => {
      const { taskId } = request.params;
      const session = get(taskId);

      if (!session) {
        // Try persisted
        const meta = await store.getMetadata(taskId);
        if (meta) {
          return {
            task_id: taskId,
            status: 'completed',
            graph_id: taskId,
            node_count: meta.nodeCount,
            edge_count: meta.edgeCount,
          };
        }

        reply.code(404);
        return { detail: `Task not found: ${taskId}` };
      }

      const progress = session.coordinator.getProgress();

      return {
        task_id: taskId,
        status: session.status,
        graph_id: session.id,
        node_count: session.result?.nodes.length ?? 0,
        edge_count: session.result?.edges.length ?? 0,
        message: progress.currentTask,
        error: session.error,
      };
    }
  );
};

export default frontendRoutes;