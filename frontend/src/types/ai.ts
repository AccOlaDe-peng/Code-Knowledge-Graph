export interface AiProvider {
  id: string
  name: string
  displayName: string
  baseUrl: string
  description: string
  enabled: boolean
  models: AiModel[]
}

export interface AiModel {
  id: string
  providerId: string
  modelName: string
  displayName: string
  maxTokens: number
  contextWindow: number
  pricing: number
  enabled: boolean
}

export interface AiApiKey {
  id: string
  userId: string
  providerId: string
  apiKey: string
  keyName: string
  baseUrl?: string
  status: 'active' | 'inactive' | 'expired'
  lastUsedAt: string
  provider: AiProvider
  createdAt: string
}

export interface AiConfig {
  id: string
  userId: string
  configName: string
  providerId: string
  modelId: string
  apiKey: string
  baseUrl?: string
  isActive: boolean
  lastUsedAt?: string
  provider: AiProvider
  model: AiModel
  createdAt: string
  updatedAt: string
}

export interface AiAnalysis {
  id: string
  projectId: string
  filePath: string
  analysisType: 'code_summary' | 'risk_analysis' | 'tech_debt'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  summary: string
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  techDebtScore?: number
  analysisJson: CodeSummaryResult | RiskAnalysisResult | TechDebtResult
  promptTokens: number
  completionTokens: number
  model: AiModel
  createdAt: string
}

export interface CodeSummaryResult {
  summary: string
  businessLogic: string
  keyComponents: Array<{
    name: string
    type: 'class' | 'function'
    responsibility: string
  }>
  designPatterns: string[]
}

export interface RiskAnalysisResult {
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical'
  risks: Array<{
    type: 'security' | 'performance' | 'maintainability'
    severity: 'low' | 'medium' | 'high' | 'critical'
    description: string
    location: string
    suggestion: string
  }>
}

export interface TechDebtResult {
  qualityScore: number
  techDebts: Array<{
    type: string
    priority: 'low' | 'medium' | 'high'
    description: string
    location: string
    estimatedEffort: 'small' | 'medium' | 'large'
    suggestion: string
  }>
}

export interface CreateAiApiKeyDto {
  providerId: string
  apiKey: string
  keyName?: string
  baseUrl?: string
}

export interface CreateAiConfigDto {
  configName: string
  providerId: string
  modelId: string
  apiKey: string
  baseUrl?: string
}

export interface UpdateAiConfigDto {
  configName?: string
  providerId?: string
  modelId?: string
  apiKey?: string
  baseUrl?: string
}

export interface TriggerAiAnalysisDto {
  analysisTypes: Array<'code_summary' | 'risk_analysis' | 'tech_debt'>
  modelId?: string
}
