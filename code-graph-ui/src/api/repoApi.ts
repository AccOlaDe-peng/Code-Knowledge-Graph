import httpClient from './graphApi'
import type { AnalyzeRepoRequest, AnalyzeRepoResponse } from '../types/api'

// ─── Repo API ─────────────────────────────────────────────────────────────────

export const repoApi = {
  /**
   * POST /analyze/repository
   * Triggers full pipeline analysis on the given local repo path.
   */
  analyzeRepository(req: AnalyzeRepoRequest): Promise<AnalyzeRepoResponse> {
    return httpClient.post('/analyze/repository', {
      repo_path:  req.repoPath,
      repo_name:  req.repoName,
      languages:  req.languages,
      enable_ai:  req.enableAi  ?? false,
      enable_rag: req.enableRag ?? false,
    })
  },
}
