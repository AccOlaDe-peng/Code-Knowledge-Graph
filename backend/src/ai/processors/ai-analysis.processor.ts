import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { AiService } from '../ai.service';
import { PromptBuilderService } from '../prompts/prompt-builder.service';
import { ResponseParserService } from '../parsers/response-parser.service';
import { AiGraphBuilderService } from '../graph/ai-graph-builder.service';
import { AiAnalysisType } from '../entities/ai-analysis.entity';
import { FileNode } from '../../worker/code-analyzer.service';

@Processor('ai-analysis')
export class AiAnalysisProcessor {
  private readonly logger = new Logger(AiAnalysisProcessor.name);

  constructor(
    private aiService: AiService,
    private promptBuilder: PromptBuilderService,
    private responseParser: ResponseParserService,
    private aiGraphBuilder: AiGraphBuilderService,
  ) {}

  @Process('analyze-project-ai')
  async handleAiAnalysis(job: Job) {
    const { projectId, userId, fileNodes, analysisTypes } = job.data;

    this.logger.log(
      `Starting AI analysis for project ${projectId}, ${fileNodes.length} files`,
    );

    try {
      // 获取用户首选模型
      const model = await this.aiService.getUserPreferredModel(userId);

      // 获取用户的 API Key
      const apiKey = await this.aiService.getUserApiKeyForProvider(
        userId,
        model.providerId,
      );

      // 获取适配器（优先使用用户自定义 Base URL）
      const adapter = this.aiService.getAdapter(
        apiKey.provider.name,
        apiKey.apiKey,
        apiKey.baseUrl || apiKey.provider.baseUrl,
      );

      // 并行分析多个文件
      const analysisPromises = fileNodes.map((fileNode: FileNode) =>
        this.analyzeFile(
          projectId,
          fileNode,
          analysisTypes,
          model,
          adapter,
        ),
      );

      await Promise.all(analysisPromises);

      this.logger.log(`AI analysis completed for project ${projectId}`);
    } catch (error) {
      this.logger.error(
        `AI analysis failed for project ${projectId}: ${error.message}`,
      );
      throw error;
    }
  }

  private async analyzeFile(
    projectId: string,
    fileNode: FileNode,
    analysisTypes: AiAnalysisType[],
    model: any,
    adapter: any,
  ) {
    for (const type of analysisTypes) {
      try {
        // 构建 Prompt
        const prompt = await this.promptBuilder.build(type, fileNode);

        // 调用 AI 模型
        const response = await adapter.chat(prompt, model.modelName);

        // 解析响应
        const parsed = await this.responseParser.parse(response.content, type);

        // 存储结果到 PostgreSQL
        await this.aiService.saveAnalysis(
          projectId,
          fileNode.filePath,
          type,
          model.id,
          parsed,
          response.promptTokens,
          response.completionTokens,
        );

        // 写入图谱
        await this.aiGraphBuilder.writeAnalysisToGraph(
          projectId,
          fileNode.filePath,
          type,
          parsed,
        );

        this.logger.log(
          `AI analysis (${type}) completed for file: ${fileNode.filePath}`,
        );
      } catch (error) {
        this.logger.error(
          `AI analysis (${type}) failed for file ${fileNode.filePath}: ${error.message}`,
        );
        // 继续处理其他分析类型
      }
    }
  }
}
