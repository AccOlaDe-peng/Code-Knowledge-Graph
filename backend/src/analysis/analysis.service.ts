import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { AnalysisTask, AnalysisTaskStatus } from './analysis-task.entity';
import { CreateAnalysisTaskDto } from './dto/create-analysis-task.dto';
import { ProjectService } from '../project/project.service';
import { ProjectStatus } from '../project/project.entity';

@Injectable()
export class AnalysisService {
  constructor(
    @InjectRepository(AnalysisTask)
    private analysisTaskRepository: Repository<AnalysisTask>,
    private projectService: ProjectService,
    @InjectQueue('analysis')
    private analysisQueue: Queue,
  ) {}

  async create(userId: string, createAnalysisTaskDto: CreateAnalysisTaskDto) {
    const project = await this.projectService.findOne(
      createAnalysisTaskDto.projectId,
      userId,
    );

    if (project.status === ProjectStatus.ANALYZING) {
      throw new BadRequestException('项目正在分析中，请等待当前分析完成');
    }

    const task = this.analysisTaskRepository.create({
      projectId: project.id,
      status: AnalysisTaskStatus.PENDING,
    });

    const savedTask = await this.analysisTaskRepository.save(task);

    await this.projectService.updateStatus(
      project.id,
      ProjectStatus.ANALYZING,
    );

    await this.analysisQueue.add('analyze-project', {
      taskId: savedTask.id,
      projectId: project.id,
      userId,
    });

    return savedTask;
  }

  async findAll(userId: string, projectId?: string) {
    const query: any = {};

    if (projectId) {
      await this.projectService.findOne(projectId, userId);
      query.projectId = projectId;
    }

    return this.analysisTaskRepository.find({
      where: query,
      relations: ['project'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string) {
    const task = await this.analysisTaskRepository.findOne({
      where: { id },
      relations: ['project'],
    });

    if (!task) {
      throw new NotFoundException('Analysis task not found');
    }

    if (task.project.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return task;
  }

  async updateStatus(
    id: string,
    status: AnalysisTaskStatus,
    errorMessage?: string,
  ) {
    const task = await this.analysisTaskRepository.findOne({ where: { id } });

    if (!task) {
      throw new NotFoundException('Analysis task not found');
    }

    task.status = status;

    if (status === AnalysisTaskStatus.PROCESSING && !task.startedAt) {
      task.startedAt = new Date();
    }

    if (
      status === AnalysisTaskStatus.COMPLETED ||
      status === AnalysisTaskStatus.FAILED
    ) {
      task.finishedAt = new Date();

      const projectStatus =
        status === AnalysisTaskStatus.COMPLETED
          ? ProjectStatus.READY
          : ProjectStatus.FAILED;

      await this.projectService.updateStatus(task.projectId, projectStatus);
    }

    if (errorMessage) {
      task.errorMessage = errorMessage;
    }

    return this.analysisTaskRepository.save(task);
  }

  async updateFileCount(id: string, fileCount: number) {
    await this.analysisTaskRepository.update(id, { fileCount });

    return this.analysisTaskRepository.findOne({ where: { id } });
  }
}
