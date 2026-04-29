// Repos API routes — Repository management with persistence

import type { FastifyPluginAsync } from 'fastify';
import { list, get } from '../sessions.ts';
import { LocalFileStore } from '../../graph/store/LocalFileStore.ts';
import { RepoRegistry, type RepoRecord } from '../../graph/store/RepoRegistry.ts';
import { existsSync } from 'node:fs';

const store = new LocalFileStore();
const registry = new RepoRegistry();

interface CreateRepoBody {
  repo_id?: string;
  repo_name: string;
  repo_path: string;
  branch?: string;
  source_mode?: 'local' | 'git' | 'zip';
  language?: string[];
}

interface UpdateRepoBody {
  repo_name?: string;
  branch?: string;
  language?: string[];
}

export const reposRoutes: FastifyPluginAsync = async (app) => {
  // GET /repos — list all repos
  app.get('/repos', async (request, reply) => {
    const sessions = list();
    const persisted = await store.listSessions();
    const registeredRepos = registry.list();

    // Build unified map
    const allRepos = new Map<string, {
      id: string;
      name: string;
      path?: string;
      status: string;
      createdAt: string;
      updatedAt: string;
      nodeCount: number;
      edgeCount: number;
      branch?: string;
      sourceMode: string;
      language: string[];
      taskId?: string;
      graphId?: string;
    }>();

    // Add registered repos (highest priority for metadata)
    for (const repo of registeredRepos) {
      allRepos.set(repo.repoId, {
        id: repo.repoId,
        name: repo.repoName,
        path: repo.repoPath,
        status: 'saved',
        createdAt: repo.createdAt,
        updatedAt: repo.updatedAt,
        nodeCount: 0,
        edgeCount: 0,
        branch: repo.branch,
        sourceMode: repo.sourceMode,
        language: repo.language,
      });
    }

    // Add in-memory sessions (override status for active analyses)
    for (const session of sessions) {
      const existing = allRepos.get(session.id);
      if (existing) {
        existing.status = session.status;
        existing.updatedAt = session.completedAt
          ? new Date(session.completedAt).toISOString()
          : existing.updatedAt;
      } else {
        allRepos.set(session.id, {
          id: session.id,
          name: session.id,
          status: session.status,
          createdAt: new Date(session.startedAt).toISOString(),
          updatedAt: session.completedAt
            ? new Date(session.completedAt).toISOString()
            : new Date(session.startedAt).toISOString(),
          nodeCount: 0,
          edgeCount: 0,
          sourceMode: 'local',
          language: [],
        });
      }
    }

    // Add persisted sessions and merge graph data
    for (const { sessionId, meta } of persisted) {
      const existing = allRepos.get(sessionId);
      if (existing) {
        existing.nodeCount = meta.nodeCount;
        existing.edgeCount = meta.edgeCount;
        existing.updatedAt = meta.updatedAt;
        if (existing.status === 'saved') {
          existing.status = 'completed';
          existing.graphId = sessionId;
        }
      } else {
        allRepos.set(sessionId, {
          id: sessionId,
          name: sessionId,
          status: 'completed',
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          nodeCount: meta.nodeCount,
          edgeCount: meta.edgeCount,
          sourceMode: 'local',
          language: [],
          graphId: sessionId,
        });
      }
    }

    // Format for frontend
    const repos = [...allRepos.values()].map(r => ({
      id: r.id,
      graph_id: r.graphId ?? r.id,
      name: r.name,
      path: r.path,
      status: r.status,
      branch: r.branch,
      source_mode: r.sourceMode,
      language: r.language,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      node_count: r.nodeCount,
      edge_count: r.edgeCount,
      task_id: r.taskId,
    }));

    return { repos };
  });

  // POST /repos — create repo
  app.post<{ Body: CreateRepoBody }>('/repos', async (request, reply) => {
    const body = request.body;

    if (!body.repo_path) {
      reply.code(400);
      return { detail: 'repo_path is required' };
    }

    const repoId = body.repo_id ?? registry.generateId(body.repo_path);
    const repoName = body.repo_name || repoId;

    const repo: RepoRecord = {
      repoId,
      repoName,
      repoPath: body.repo_path,
      branch: body.branch,
      sourceMode: body.source_mode ?? 'local',
      language: body.language ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    registry.save(repo);

    reply.code(201);
    return {
      id: repoId,
      graph_id: repoId,
      name: repoName,
      path: body.repo_path,
      status: 'saved',
      branch: body.branch,
      source_mode: repo.sourceMode,
      language: repo.language,
      created_at: repo.createdAt,
      updated_at: repo.updatedAt,
      node_count: 0,
      edge_count: 0,
    };
  });

  // GET /repos/:repoId — single repo
  app.get<{ Params: { repoId: string } }>('/repos/:repoId', async (request, reply) => {
    const { repoId } = request.params;

    // Try registry first
    const registered = registry.load(repoId);
    if (registered) {
      let status: string = 'saved';
      let nodeCount = 0;
      let edgeCount = 0;
      let updatedAt = registered.updatedAt;

      // Check session status
      const session = get(repoId);
      if (session) {
        status = session.status;
        updatedAt = session.completedAt
          ? new Date(session.completedAt).toISOString()
          : updatedAt;
      }

      // Check persisted graph
      const meta = await store.getMetadata(repoId);
      if (meta) {
        nodeCount = meta.nodeCount;
        edgeCount = meta.edgeCount;
        updatedAt = meta.updatedAt;
        if (status === 'saved') {
          status = 'completed';
        }
      }

      return {
        id: repoId,
        graph_id: repoId,
        name: registered.repoName,
        path: registered.repoPath,
        status,
        branch: registered.branch,
        source_mode: registered.sourceMode,
        language: registered.language,
        created_at: registered.createdAt,
        updated_at: updatedAt,
        node_count: nodeCount,
        edge_count: edgeCount,
      };
    }

    // Try in-memory session
    const session = get(repoId);
    if (session) {
      return {
        id: repoId,
        graph_id: repoId,
        name: repoId,
        status: session.status,
        created_at: new Date(session.startedAt).toISOString(),
        updated_at: session.completedAt
          ? new Date(session.completedAt).toISOString()
          : new Date(session.startedAt).toISOString(),
        node_count: session.result?.nodes.length ?? 0,
        edge_count: session.result?.edges.length ?? 0,
        source_mode: 'local',
        language: [],
      };
    }

    // Try persisted session
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
        source_mode: 'local',
        language: [],
      };
    }

    reply.code(404);
    return { detail: `Repo not found: ${repoId}` };
  });

  // PUT /repos/:repoId — update repo metadata
  app.put<{ Params: { repoId: string }; Body: UpdateRepoBody }>(
    '/repos/:repoId',
    async (request, reply) => {
      const { repoId } = request.params;
      const body = request.body;

      const updated = registry.update(repoId, {
        repoName: body.repo_name,
        branch: body.branch,
        language: body.language,
      });

      if (!updated) {
        reply.code(404);
        return { detail: `Repo not found: ${repoId}` };
      }

      return {
        id: repoId,
        name: updated.repoName,
        branch: updated.branch,
        language: updated.language,
        updated_at: updated.updatedAt,
      };
    }
  );

  // POST /repos/save — persist repo config without triggering analysis
  app.post<{ Body: CreateRepoBody }>('/repos/save', async (request, reply) => {
    const body = request.body;

    if (!body.repo_path) {
      reply.code(400);
      return { detail: 'repo_path is required' };
    }

    // Validate repo path exists
    if (!existsSync(body.repo_path)) {
      reply.code(400);
      return { detail: `Path not found: ${body.repo_path}` };
    }

    const repoId = body.repo_id ?? registry.generateId(body.repo_path);
    const repoName = body.repo_name || repoId;

    const repo: RepoRecord = {
      repoId,
      repoName,
      repoPath: body.repo_path,
      branch: body.branch,
      sourceMode: body.source_mode ?? 'local',
      language: body.language ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    registry.save(repo);
    return { repo_id: repoId, status: 'saved' };
  });

  // GET /repos/:repoId/analyses — analysis history for a repo
  app.get<{ Params: { repoId: string } }>('/repos/:repoId/analyses', async (request, _reply) => {
    const { repoId } = request.params;
    const analyses: Record<string, unknown>[] = [];

    // Check in-memory session
    const session = get(repoId);
    if (session) {
      analyses.push({
        id: session.id,
        graph_id: session.id,
        status: session.status,
        stage: session.status,
        node_count: session.result?.nodes.length ?? 0,
        edge_count: session.result?.edges.length ?? 0,
        started_at: new Date(session.startedAt).toISOString(),
        finished_at: session.completedAt ? new Date(session.completedAt).toISOString() : null,
        error: session.error,
      });
    }

    // Check persisted
    const meta = await store.getMetadata(repoId);
    if (meta) {
      analyses.push({
        id: repoId,
        graph_id: repoId,
        status: 'completed',
        node_count: meta.nodeCount,
        edge_count: meta.edgeCount,
        started_at: meta.createdAt,
        finished_at: meta.updatedAt,
      });
    }

    return { analyses };
  });

  // DELETE /repos/:repoId — delete repo and associated data
  app.delete<{ Params: { repoId: string } }>('/repos/:repoId', async (request, reply) => {
    const { repoId } = request.params;

    // 从 RepoRegistry 删除
    registry.delete(repoId);

    // 从持久化存储删除
    await store.delete(repoId);

    // 返回成功（幂等操作，无论如何都返回成功）
    return { message: `Repo ${repoId} deleted` };
  });
};

export default reposRoutes;
