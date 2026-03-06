import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, ProjectStatus } from './project.entity';
import {
  Repository as RepositoryEntity,
} from '../repository/repository.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectService {
  constructor(
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
    @InjectRepository(RepositoryEntity)
    private repositoryRepository: Repository<RepositoryEntity>,
  ) {}

  async create(userId: string, createProjectDto: CreateProjectDto) {
    const { name, provider, repositoryUrl, branch } = createProjectDto;

    const project = this.projectRepository.create({
      name,
      userId,
      status: ProjectStatus.PENDING,
    });

    const savedProject = await this.projectRepository.save(project);

    if (provider && repositoryUrl) {
      const repo = this.repositoryRepository.create({
        projectId: savedProject.id,
        provider,
        repoUrl: repositoryUrl,
        branch: branch || 'main',
      });
      await this.repositoryRepository.save(repo);
    }

    return savedProject;
  }

  async findAll(userId: string) {
    return this.projectRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string) {
    const project = await this.projectRepository.findOne({
      where: { id },
      relations: ['repositories', 'analysisTasks'],
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (project.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return project;
  }

  async update(id: string, userId: string, updateProjectDto: UpdateProjectDto) {
    const project = await this.findOne(id, userId);

    Object.assign(project, updateProjectDto);

    return this.projectRepository.save(project);
  }

  async remove(id: string, userId: string) {
    const project = await this.findOne(id, userId);

    await this.projectRepository.remove(project);

    return { message: 'Project deleted successfully' };
  }

  async updateStatus(id: string, status: ProjectStatus) {
    await this.projectRepository.update(id, { status });

    return this.projectRepository.findOne({ where: { id } });
  }
}
