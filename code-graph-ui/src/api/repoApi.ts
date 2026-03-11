import api from './graphApi';
import type { AnalyzeRepoRequest, AnalyzeRepoResponse } from '../types/api';

export const repoApi = {
  // 分析仓库
  analyzeRepository(request: AnalyzeRepoRequest): Promise<AnalyzeRepoResponse> {
    return api.post('/analyze/repository', {
      repo_path: request.repoPath,
      repo_name: request.repoName,
      languages: request.languages,
      enable_ai: request.enableAi ?? false,
      enable_rag: request.enableRag ?? false,
    });
  },
};
