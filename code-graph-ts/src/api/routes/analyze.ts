// Analysis routes — submit, status, stream, cancel

import type { FastifyInstance } from 'fastify';
import { create, startAnalysis, get, cancel } from '../sessions.ts';
import { logger } from '../logger.ts';

interface AnalyzeBody {
  path?: string;
  repo_path?: string; // 兼容前端字段名
  repo_name?: string;
  repo_id?: string;
  branch?: string;
  languages?: string[];
}

// Default analysis configuration
const DEFAULT_BUDGET = 100000; // 100K tokens for LLM

export async function analyzeRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/pipeline/stages — pipeline stage definitions for frontend
  app.get('/pipeline/stages', async () => {
    const stages = [
      { key: 'file_index', label: '文件扫描', description: '扫描并索引仓库中的源文件' },
      { key: 'deep_static_analysis', label: '静态分析', description: '基于 AST 的深度静态结构提取' },
      { key: 'ai_semantic_enhance', label: 'AI 语义增强', description: 'LLM 驱动的模块边界与语义关系识别' },
      { key: 'data_lineage', label: '数据血缘', description: '追踪数据在函数与模块间的流动路径' },
      { key: 'graph_build', label: '图谱构建', description: '合并多源分析结果为统一知识图谱' },
      { key: 'report', label: '报告生成', description: '生成架构概览与优化建议' },
    ];
    return { stages, total: stages.length };
  });

  // Submit analysis
  app.post<{ Body: AnalyzeBody }>('/analyze/repository', async (request, reply) => {
    const { path, repo_path, repo_name, repo_id, branch, languages } = request.body;
    const repoPath = repo_path ?? path;

    if (!repoPath) {
      reply.code(400);
      return { error: 'repo_path is required' };
    }

    const session = create(repoPath, {
      budget: DEFAULT_BUDGET,
      repoName: repo_name,
      repoId: repo_id,
      repoPath,
      branch,
      languages,
    });

    // Start analysis in background (non-blocking)
    startAnalysis(session.id, repoPath, {
      budget: DEFAULT_BUDGET,
      repoId: repo_id,
      repoName: repo_name,
      repoPath,
    }).catch((err) => {
      logger.error(`Unhandled error in background analysis for session ${session.id}: ${err instanceof Error ? err.message : String(err)}`);
    });

    reply.code(202);
    return {
      sessionId: session.id,
      status: 'pending',
    };
  });

  // Build frontend-compatible progress event payload
  function buildProgressEvent(session: ReturnType<typeof get>): Record<string, unknown> {
    if (!session) return { status: 'unknown' };
    const stageProgress = session.coordinator.getStageProgress();
    const nodeCount = session.result?.nodes.length ?? 0;
    const edgeCount = session.result?.edges.length ?? 0;
    const elapsed = session.startedAt ? Math.round((Date.now() - session.startedAt) / 1000) : 0;
    return {
      status: session.status,
      step: stageProgress.step,
      total: stageProgress.total,
      stage: stageProgress.stage,
      message: stageProgress.message,
      elapsed_seconds: elapsed,
      node_count: nodeCount,
      edge_count: edgeCount,
      error: session.error,
    };
  }

  // Poll status
  app.get<{ Params: { sessionId: string } }>('/analyze/status/:sessionId', async (request, reply) => {
    const session = get(request.params.sessionId);
    if (!session) {
      reply.code(404);
      return { error: `Session not found: ${request.params.sessionId}` };
    }

    const progress = buildProgressEvent(session);

    return {
      sessionId: session.id,
      ...progress,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    };
  });

  // SSE progress stream
  app.get<{ Params: { sessionId: string } }>('/analyze/stream/:sessionId', async (request, reply) => {
    const session = get(request.params.sessionId);
    if (!session) {
      reply.code(404);
      return { error: `Session not found: ${request.params.sessionId}` };
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let lastStatus = '';

    const interval = setInterval(() => {
      const current = get(request.params.sessionId);
      if (!current) {
        reply.raw.write(`event: error\ndata: {"error":"session lost"}\n\n`);
        clearInterval(interval);
        reply.raw.end();
        return;
      }

      const statusStr = JSON.stringify(buildProgressEvent(current));

      // Only send if status changed, or heartbeat every 15s
      if (statusStr !== lastStatus) {
        lastStatus = statusStr;
        reply.raw.write(`event: progress\ndata: ${statusStr}\n\n`);
      }

      // Terminal state — close stream
      if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') {
        clearInterval(interval);
        reply.raw.write(`event: done\ndata: ${statusStr}\n\n`);
        reply.raw.end();
      }
    }, 1000);

    // Heartbeat every 15s
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
        clearInterval(interval);
      }
    }, 15000);

    // Cleanup on disconnect
    request.raw.on('close', () => {
      clearInterval(interval);
      clearInterval(heartbeat);
    });
  });

  // Cancel analysis
  app.post<{ Params: { sessionId: string } }>('/analyze/cancel/:sessionId', async (request, reply) => {
    const session = get(request.params.sessionId);
    if (!session) {
      reply.code(404);
      return { error: `Session not found: ${request.params.sessionId}` };
    }

    if (session.status !== 'running' && session.status !== 'pending') {
      reply.code(400);
      return { error: `Cannot cancel session in ${session.status} state` };
    }

    cancel(request.params.sessionId);
    return { sessionId: session.id, status: 'cancelled' };
  });
}
