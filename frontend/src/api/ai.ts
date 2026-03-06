import api from './index'
import type {
  AiProvider,
  AiModel,
  AiApiKey,
  AiConfig,
  AiAnalysis,
  CreateAiApiKeyDto,
  CreateAiConfigDto,
  UpdateAiConfigDto,
  TriggerAiAnalysisDto,
} from '../types/ai'

export const aiApi = {
  // 提供商和模型
  getProviders: () => api.get<AiProvider[]>('/ai/providers'),
  getModels: (providerId: string) =>
    api.get<AiModel[]>(`/ai/providers/${providerId}/models`),

  // API Key 管理（旧版，保留兼容）
  getApiKeys: () => api.get<AiApiKey[]>('/ai/api-keys'),
  createApiKey: (data: CreateAiApiKeyDto) =>
    api.post<AiApiKey>('/ai/api-keys', data),
  deleteApiKey: (id: string) => api.delete(`/ai/api-keys/${id}`),

  // AI 配置管理（新版）
  getConfigs: () => api.get<AiConfig[]>('/ai/configs'),
  getActiveConfig: () => api.get<AiConfig>('/ai/configs/active'),
  createConfig: (data: CreateAiConfigDto) =>
    api.post<AiConfig>('/ai/configs', data),
  updateConfig: (id: string, data: UpdateAiConfigDto) =>
    api.put<AiConfig>(`/ai/configs/${id}`, data),
  setActiveConfig: (id: string) =>
    api.put<AiConfig>(`/ai/configs/${id}/activate`, {}),
  deleteConfig: (id: string) => api.delete(`/ai/configs/${id}`),

  // 分析结果
  getProjectAnalyses: (projectId: string) =>
    api.get<AiAnalysis[]>(`/ai/analyses/projects/${projectId}`),
  getFileAnalyses: (projectId: string, filePath: string) =>
    api.get<AiAnalysis[]>(
      `/ai/analyses/projects/${projectId}/files/${encodeURIComponent(filePath)}`
    ),
  triggerAnalysis: (projectId: string, data: TriggerAiAnalysisDto) =>
    api.post(`/ai/analyses/projects/${projectId}/trigger`, data),
}
