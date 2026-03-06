import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { AnalysisTaskStatus } from './analysis-task.entity';
import { WorkerService } from '../worker/worker.service';

@Processor('analysis')
export class AnalysisProcessor {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    private analysisService: AnalysisService,
    private workerService: WorkerService,
  ) {}

  @Process('analyze-project')
  async handleAnalysis(job: Job) {
    const { taskId, projectId, userId } = job.data;

    this.logger.log(`Starting analysis for task ${taskId}`);

    try {
      // 调用 WorkerService 执行实际的代码分析
      const result = await this.workerService.processAnalysisTask(
        taskId,
        projectId,
      );

      this.logger.log(
        `Analysis completed for task ${taskId}, processed ${result.fileCount} files`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Analysis failed for task ${taskId}:`, error);
      throw error;
    }
  }
}
