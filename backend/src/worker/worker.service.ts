import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as path from 'path';
import * as fs from 'fs';
import simpleGit, { SimpleGit } from 'simple-git';
import { Repository, RepositoryProvider } from '../repository/repository.entity';
import { AnalysisTask, AnalysisTaskStatus } from '../analysis/analysis-task.entity';
import { AnalysisService } from '../analysis/analysis.service';
import { CodeAnalyzerService, FileNode } from './code-analyzer.service';
import { GraphService } from '../graph/graph.service';
import { AiService } from '../ai/ai.service';
import { AiAnalysisType } from '../ai/entities/ai-analysis.entity';

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);
  private git: SimpleGit;

  constructor(
    @InjectRepository(Repository)
    private repositoryRepository: TypeOrmRepository<Repository>,
    @InjectRepository(AnalysisTask)
    private analysisTaskRepository: TypeOrmRepository<AnalysisTask>,
    private analysisService: AnalysisService,
    private codeAnalyzerService: CodeAnalyzerService,
    private graphService: GraphService,
    private aiService: AiService,
    @InjectQueue('analysis')
    private analysisQueue: Queue,
    @InjectQueue('ai-analysis')
    private aiAnalysisQueue: Queue,
  ) {
    this.git = simpleGit();
  }

  async processAnalysisTask(taskId: string, projectId: string) {
    this.logger.log(`Processing analysis task ${taskId} for project ${projectId}`);

    try {
      await this.analysisService.updateStatus(
        taskId,
        AnalysisTaskStatus.PROCESSING,
      );

      const repositories = await this.repositoryRepository.find({
        where: { projectId },
      });

      if (repositories.length === 0) {
        throw new Error('No repositories found for project');
      }

      const workDir = path.join(process.cwd(), 'temp', projectId);

      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true });
      }

      let codeDir: string;
      const repository = repositories[0];

      if (repository.provider === RepositoryProvider.ZIP) {
        codeDir = await this.extractZip(repository.repoUrl, workDir);
      } else {
        codeDir = await this.cloneRepository(
          repository.repoUrl,
          repository.branch,
          workDir,
        );
      }

      this.logger.log(`Code prepared at: ${codeDir}`);

      const fileNodes = await this.codeAnalyzerService.analyzeProject(codeDir);

      await this.analysisService.updateFileCount(taskId, fileNodes.length);

      this.logger.log(`Analysis complete. Found ${fileNodes.length} files`);

      await this.graphService.writeProjectGraph(projectId, fileNodes);

      this.logger.log(`Graph data written to Neo4j`);

      // 【新增】触发 AI 分析（如果用户配置了 API Key）
      try {
        const task = await this.analysisTaskRepository.findOne({
          where: { id: taskId },
          relations: ['project', 'project.user'],
        });

        if (task && task.project && task.project.userId) {
          const userId = task.project.userId;
          const hasApiKey = await this.aiService.userHasApiKey(userId);

          if (hasApiKey) {
            this.logger.log(`Triggering AI analysis for project ${projectId}`);
            await this.aiAnalysisQueue.add('analyze-project-ai', {
              projectId,
              userId,
              fileNodes: fileNodes.slice(0, 10), // 限制分析文件数量
              analysisTypes: [
                AiAnalysisType.CODE_SUMMARY,
                AiAnalysisType.RISK_ANALYSIS,
                AiAnalysisType.TECH_DEBT,
              ],
            });
          } else {
            this.logger.log(`User ${userId} has no active API key, skipping AI analysis`);
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to trigger AI analysis: ${error.message}`);
        // AI 分析失败不影响主流程
      }

      await this.analysisService.updateStatus(
        taskId,
        AnalysisTaskStatus.COMPLETED,
      );

      this.cleanupWorkDir(workDir);

      return {
        success: true,
        fileCount: fileNodes.length,
      };
    } catch (error) {
      this.logger.error(`Analysis task ${taskId} failed:`, error);

      await this.analysisService.updateStatus(
        taskId,
        AnalysisTaskStatus.FAILED,
        error.message,
      );

      throw error;
    }
  }

  private async cloneRepository(
    repoUrl: string,
    branch: string,
    workDir: string,
  ): Promise<string> {
    this.logger.log(`Cloning repository: ${repoUrl} (branch: ${branch})`);

    const targetDir = path.join(workDir, 'repo');

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    const cloneArgs = ['--depth', '1'];
    if (branch && branch !== 'main' && branch !== 'master') {
      cloneArgs.push('--branch', branch);
    } else {
      // 先尝试指定分支，失败则不带分支克隆默认分支
      try {
        await this.git.clone(repoUrl, targetDir, ['--depth', '1', '--branch', branch]);
        this.logger.log(`Repository cloned to: ${targetDir}`);
        return targetDir;
      } catch {
        this.logger.warn(`Branch "${branch}" not found, cloning default branch`);
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
      }
    }

    await this.git.clone(repoUrl, targetDir, cloneArgs);

    this.logger.log(`Repository cloned to: ${targetDir}`);

    return targetDir;
  }

  private async extractZip(zipPath: string, workDir: string): Promise<string> {
    this.logger.log(`Extracting ZIP: ${zipPath}`);

    const targetDir = path.join(workDir, 'extracted');

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 简化实现：假设 ZIP 已经上传到指定路径
    // 实际生产环境需要使用 unzip 库
    this.logger.warn('ZIP extraction not fully implemented');

    return zipPath;
  }

  private cleanupWorkDir(workDir: string) {
    try {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
        this.logger.log(`Cleaned up work directory: ${workDir}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to cleanup work directory: ${error.message}`);
    }
  }
}
