import httpClient from './graphApi'
import type { AnalyzeRepoRequest, AnalyzeRepoResponse } from '../types/api'

// ─── Repo API ─────────────────────────────────────────────────────────────────

export const repoApi = {
  /**
   * POST /analyze/repository
   * Triggers full pipeline analysis on the given local repo path.
   */
  async analyzeRepository(req: AnalyzeRepoRequest): Promise<AnalyzeRepoResponse> {
    const raw: Record<string, unknown> = await httpClient.post('/analyze/repository', {
      repo_path:  req.repoPath,
      repo_name:  req.repoName,
      languages:  req.languages,
      enable_ai:  req.enableAi  ?? false,
      enable_rag: req.enableRag ?? false,
    })
    return {
      graphId:   raw.graph_id   as string,
      repoName:  raw.repo_name  as string,
      nodeCount: raw.node_count as number,
      edgeCount: raw.edge_count as number,
      duration:  raw.duration   as number,
      stepStats: raw.step_stats as Record<string, number>,
    }
  },
}
