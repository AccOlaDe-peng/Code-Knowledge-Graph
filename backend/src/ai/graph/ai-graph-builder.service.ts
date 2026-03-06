import { Injectable, Logger } from '@nestjs/common';
import { GraphService } from '../../graph/graph.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AiGraphBuilderService {
  private readonly logger = new Logger(AiGraphBuilderService.name);

  constructor(private graphService: GraphService) {}

  async writeAnalysisToGraph(
    projectId: string,
    filePath: string,
    analysisType: string,
    analysisResult: any,
  ) {
    const session = this.graphService.getSession();

    try {
      // 创建 AI 分析节点
      await session.run(
        `
        MATCH (f:File {projectId: $projectId, path: $filePath})
        MERGE (a:AiAnalysis {
          id: $analysisId,
          projectId: $projectId,
          analysisType: $analysisType,
          summary: $summary,
          createdAt: datetime()
        })
        MERGE (f)-[:HAS_AI_ANALYSIS]->(a)
        `,
        {
          projectId,
          filePath,
          analysisId: uuidv4(),
          analysisType,
          summary: analysisResult.summary || '',
        },
      );

      // 写入风险节点
      if (analysisResult.risks) {
        for (const risk of analysisResult.risks) {
          await this.writeRiskNode(session, projectId, filePath, risk);
        }
      }

      // 写入技术债节点
      if (analysisResult.techDebts) {
        for (const debt of analysisResult.techDebts) {
          await this.writeTechDebtNode(session, projectId, filePath, debt);
        }
      }

      this.logger.log(
        `AI analysis written to graph for file: ${filePath}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to write AI analysis to graph: ${error.message}`,
      );
      throw error;
    } finally {
      await session.close();
    }
  }

  private async writeRiskNode(session, projectId, filePath, risk) {
    await session.run(
      `
      MATCH (f:File {projectId: $projectId, path: $filePath})
      MATCH (a:AiAnalysis)-[:HAS_AI_ANALYSIS]-(f)
      WHERE a.projectId = $projectId
      MERGE (r:Risk {
        id: $riskId,
        type: $type,
        severity: $severity,
        description: $description,
        suggestion: $suggestion
      })
      MERGE (a)-[:IDENTIFIES_RISK]->(r)
      MERGE (r)-[:AFFECTS]->(f)
      `,
      {
        projectId,
        filePath,
        riskId: uuidv4(),
        type: risk.type,
        severity: risk.severity,
        description: risk.description,
        suggestion: risk.suggestion,
      },
    );
  }

  private async writeTechDebtNode(session, projectId, filePath, debt) {
    await session.run(
      `
      MATCH (f:File {projectId: $projectId, path: $filePath})
      MATCH (a:AiAnalysis)-[:HAS_AI_ANALYSIS]-(f)
      WHERE a.projectId = $projectId
      MERGE (t:TechDebt {
        id: $debtId,
        type: $type,
        priority: $priority,
        description: $description,
        estimatedEffort: $estimatedEffort
      })
      MERGE (a)-[:IDENTIFIES_TECH_DEBT]->(t)
      `,
      {
        projectId,
        filePath,
        debtId: uuidv4(),
        type: debt.type,
        priority: debt.priority,
        description: debt.description,
        estimatedEffort: debt.estimatedEffort,
      },
    );
  }
}
