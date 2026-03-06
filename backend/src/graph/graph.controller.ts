import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { GraphService } from './graph.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectService } from '../project/project.service';

@Controller('graph')
@UseGuards(JwtAuthGuard)
export class GraphController {
  constructor(
    private graphService: GraphService,
    private projectService: ProjectService,
  ) {}

  @Get('projects/:projectId')
  async getProjectGraph(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);

    return this.graphService.getProjectGraph(projectId);
  }

  @Get('projects/:projectId/files/:filePath/dependencies')
  async getFileDependencies(
    @Param('projectId') projectId: string,
    @Param('filePath') filePath: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);

    return this.graphService.getFileDependencies(projectId, filePath);
  }

  @Get('projects/:projectId/files/:filePath/references')
  async getFileReferences(
    @Param('projectId') projectId: string,
    @Param('filePath') filePath: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);

    return this.graphService.getFileReferences(projectId, filePath);
  }

  @Get('projects/:projectId/circular-dependencies')
  async findCircularDependencies(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);

    return this.graphService.findCircularDependencies(projectId);
  }

  @Get('projects/:projectId/functions/:functionName/call-chain')
  async getFunctionCallChain(
    @Param('projectId') projectId: string,
    @Param('functionName') functionName: string,
    @Query('depth') depth: number = 3,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);

    return this.graphService.getFunctionCallChain(
      projectId,
      functionName,
      depth,
    );
  }

  @Delete('projects/:projectId')
  async deleteProjectGraph(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);

    await this.graphService.deleteProjectGraph(projectId);

    return { message: 'Project graph deleted successfully' };
  }
}
