export class AiAnalysisResultDto {
  id: string;
  projectId: string;
  filePath: string;
  analysisType: string;
  status: string;
  summary: string;
  riskLevel?: string;
  techDebtScore?: number;
  analysisJson: any;
  promptTokens?: number;
  completionTokens?: number;
  createdAt: Date;
  updatedAt: Date;
}

export class CodeSummaryResult {
  summary: string;
  businessLogic: string;
  keyComponents: Array<{
    name: string;
    type: 'class' | 'function';
    responsibility: string;
  }>;
  designPatterns: string[];
}

export class RiskAnalysisResult {
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  risks: Array<{
    type: 'security' | 'performance' | 'maintainability';
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    location: string;
    suggestion: string;
  }>;
}

export class TechDebtResult {
  qualityScore: number;
  techDebts: Array<{
    type: string;
    priority: 'low' | 'medium' | 'high';
    description: string;
    location: string;
    estimatedEffort: 'small' | 'medium' | 'large';
    suggestion: string;
  }>;
}
