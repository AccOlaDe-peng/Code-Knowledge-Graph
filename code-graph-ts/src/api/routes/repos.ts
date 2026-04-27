// Repos API routes — compatible with frontend
// Maps sessions to repos for backward compatibility

import type { FastifyPluginAsync } from 'fastify';
import { list, get } from '../sessions.ts';
import { LocalFileStore } from '../../graph/store/LocalFileStore.ts';

const store = new LocalFileStore();

export const reposRoutes: FastifyPluginAsync = async (app) => {
  // GET /repos — list all repos/sessions
  app.get('/repos', async (request, reply) => {
    const sessions = list();

    // Also get persisted sessions from storage
    const persisted = await store.listSessions();

    // Merge in-memory and persisted
    const allSessions = new Map<string, {
      id: string;
      name: string;
      path?: string;
      status: string;
      createdAt: string;
      updatedAt?: string;
      nodeCount: number;
      edgeCount: number;
    }>();

    // Add in-memory sessions
    for (const session of sessions) {
      allSessions.set(session.id, {
        id: session.id,
        name: session.id,
        status: session.status,
        createdAt: new Date(session.startedAt).toISOString(),
        updatedAt: session.completedAt ? new Date(session.completedAt).toISOString() : undefined,
        nodeCount: 0,
        edgeCount: 0,
      });
    }

    // Add persisted sessions
    for (const { sessionId, meta } of persisted) {
      if (!allSessions.has(sessionId)) {
        allSessions.set(sessionId, {
          id: sessionId,
          name: sessionId,
          status: 'completed',
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          nodeCount: meta.nodeCount,
          edgeCount: meta.edgeCount,
        });
      } else {
        const existing = allSessions.get(sessionId)!;
        existing.nodeCount = meta.nodeCount;
        existing.edgeCount = meta.edgeCount;
        existing.updatedAt = meta.updatedAt;
      }
    }

    // Format for frontend
    const repos = [...allSessions.values()].map(s => ({
      id: s.id,
      graph_id: s.id,
      name: s.name,
      path: s.path,
      status: s.status,
      language: [],
      created_at: s.createdAt,
      updated_at: s.updatedAt ?? s.createdAt,
      node_count: s.nodeCount,
      edge_count: s.edgeCount,
      source_mode: 'local',
    }));

    return { repos };
  });

  // POST /repos — create repo (placeholder for frontend)
  app.post('/repos', async (request, reply) => {
    reply.code(201);
    return { message: 'Use POST /api/analyze/repository to analyze codebase' };
  });

  // GET /repos/:repoId — single repo
  app.get<{ Params: { repoId: string } }>('/repos/:repoId', async (request, reply) => {
    const { repoId } = request.params;

    // Try in-memory first
    const session = get(repoId);
    if (session) {
      return {
        id: repoId,
        graph_id: repoId,
        name: repoId,
        status: session.status,
        created_at: new Date(session.startedAt).toISOString(),
        updated_at: session.completedAt ? new Date(session.completedAt).toISOString() : undefined,
        node_count: session.result?.nodes.length ?? 0,
        edge_count: session.result?.edges.length ?? 0,
      };
    }

    // Try persisted
    const meta = await store.getMetadata(repoId);
    if (meta) {
      return {
        id: repoId,
        graph_id: repoId,
        name: repoId,
        status: 'completed',
        created_at: meta.createdAt,
        updated_at: meta.updatedAt,
        node_count: meta.nodeCount,
        edge_count: meta.edgeCount,
      };
    }

    reply.code(404);
    return { detail: `Repo not found: ${repoId}` };
  });
};

export default reposRoutes;
