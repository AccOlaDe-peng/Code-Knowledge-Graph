import httpClient from './graphApi'
import type { AnalyzeRepoRequest, AnalyzeRepoResponse } from '../types/api'

// ─── Repo API ─────────────────────────────────────────────────────────────────

function toRepoResponse(raw: Record<string, unknown>): AnalyzeRepoResponse {
  return {
    graphId:   raw.graph_id        as string,
    repoName:  raw.repo_name       as string,
    nodeCount: raw.node_count      as number,
    edgeCount: raw.edge_count      as number,
    duration:  (raw.duration_seconds ?? raw.duration) as number,
    stepStats: raw.step_stats      as Record<string, number>,
  }
}

export const repoApi = {
  /**
   * POST /analyze/repository
   * 支持本地路径或 Git URL（SSH/HTTPS）。
   */
  async analyzeRepository(req: AnalyzeRepoRequest): Promise<AnalyzeRepoResponse> {
    const raw: Record<string, unknown> = await httpClient.post('/analyze/repository', {
      repo_path:  req.repoPath,
      repo_name:  req.repoName,
      branch:     req.branch,
      languages:  req.languages,
      enable_ai:  req.enableAi  ?? false,
      enable_rag: req.enableRag ?? false,
    })
    return toRepoResponse(raw)
  },

  /**
   * POST /analyze/upload-zip
   * 上传 ZIP 压缩包分析。
   */
  async analyzeZip(
    file: File,
    opts: {
      repoName?: string
      languages?: string[]
      enableAi?: boolean
      enableRag?: boolean
    } = {},
  ): Promise<AnalyzeRepoResponse> {
    const form = new FormData()
    form.append('file', file)
    form.append('repo_name',  opts.repoName  ?? '')
    form.append('languages',  (opts.languages ?? []).join(','))
    form.append('enable_ai',  String(opts.enableAi  ?? false))
    form.append('enable_rag', String(opts.enableRag ?? false))

    const raw: Record<string, unknown> = await httpClient.post(
      '/analyze/upload-zip',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return toRepoResponse(raw)
  },
}
