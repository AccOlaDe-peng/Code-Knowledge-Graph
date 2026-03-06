import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import { Repository, RepositoryProvider } from './repository.entity';
import { CreateRepositoryDto } from './dto/create-repository.dto';
import { ProjectService } from '../project/project.service';

@Injectable()
export class RepositoryService {
  constructor(
    @InjectRepository(Repository)
    private repositoryRepository: TypeOrmRepository<Repository>,
    private projectService: ProjectService,
    private configService: ConfigService,
  ) {}

  async create(userId: string, createRepositoryDto: CreateRepositoryDto) {
    await this.projectService.findOne(createRepositoryDto.projectId, userId);

    const repository = this.repositoryRepository.create(createRepositoryDto);

    return this.repositoryRepository.save(repository);
  }

  async createFromOAuth(
    userId: string,
    projectId: string,
    provider: RepositoryProvider,
    repoUrl: string,
    branch: string,
  ) {
    await this.projectService.findOne(projectId, userId);

    const repository = this.repositoryRepository.create({
      projectId,
      provider,
      repoUrl,
      branch,
    });

    return this.repositoryRepository.save(repository);
  }

  async createFromZip(
    userId: string,
    projectId: string,
    file: Express.Multer.File,
  ) {
    await this.projectService.findOne(projectId, userId);

    if (!file) {
      throw new BadRequestException('ZIP file is required');
    }

    if (!file.originalname.endsWith('.zip')) {
      throw new BadRequestException('Only ZIP files are allowed');
    }

    const uploadDir = path.join(process.cwd(), 'uploads', projectId);

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, file.originalname);

    fs.writeFileSync(filePath, file.buffer);

    const repository = this.repositoryRepository.create({
      projectId,
      provider: RepositoryProvider.ZIP,
      repoUrl: filePath,
      branch: 'main',
    });

    return this.repositoryRepository.save(repository);
  }

  async findByProject(projectId: string, userId: string) {
    await this.projectService.findOne(projectId, userId);

    return this.repositoryRepository.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string) {
    const repository = await this.repositoryRepository.findOne({
      where: { id },
      relations: ['project'],
    });

    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    if (repository.project.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return repository;
  }

  async remove(id: string, userId: string) {
    const repository = await this.findOne(id, userId);

    await this.repositoryRepository.remove(repository);

    return { message: 'Repository deleted successfully' };
  }

  getGithubAuthUrl(projectId: string, userId: string): string {
    const clientId = this.configService.get('GITHUB_CLIENT_ID');
    const callbackUrl = this.configService.get('GITHUB_CALLBACK_URL');
    const state = Buffer.from(JSON.stringify({ projectId, userId })).toString('base64');

    return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${callbackUrl}&scope=repo&state=${state}`;
  }

  getGitlabAuthUrl(projectId: string, userId: string): string {
    const clientId = this.configService.get('GITLAB_CLIENT_ID');
    const callbackUrl = this.configService.get('GITLAB_CALLBACK_URL');
    const state = Buffer.from(JSON.stringify({ projectId, userId })).toString('base64');

    return `https://gitlab.com/oauth/authorize?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=read_repository&state=${state}`;
  }
}
