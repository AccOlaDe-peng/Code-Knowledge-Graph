import { Injectable } from '@nestjs/common';
import { FileNode } from '../../worker/code-analyzer.service';
import { AiAnalysisType } from '../entities/ai-analysis.entity';
import { PromptTemplate } from './templates/base.template';
import { CodeSummaryTemplate } from './templates/code-summary.template';
import { RiskAnalysisTemplate } from './templates/risk-analysis.template';
import { TechDebtTemplate } from './templates/tech-debt.template';

@Injectable()
export class PromptBuilderService {
  async build(
    analysisType: AiAnalysisType,
    fileNode: FileNode,
  ): Promise<string> {
    const template = this.getTemplate(analysisType);
    return template.render(fileNode);
  }

  private getTemplate(type: AiAnalysisType): PromptTemplate {
    switch (type) {
      case AiAnalysisType.CODE_SUMMARY:
        return new CodeSummaryTemplate();
      case AiAnalysisType.RISK_ANALYSIS:
        return new RiskAnalysisTemplate();
      case AiAnalysisType.TECH_DEBT:
        return new TechDebtTemplate();
      default:
        throw new Error(`Unknown analysis type: ${type}`);
    }
  }
}
