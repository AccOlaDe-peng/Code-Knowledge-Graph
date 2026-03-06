import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalysisService } from '../analysis/analysis.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectController {
  constructor(
    private projectService: ProjectService,
    private analysisService: AnalysisService,
  ) {}

  @Post()
  create(@Request() req, @Body() createProjectDto: CreateProjectDto) {
    return this.projectService.create(req.user.userId, createProjectDto);
  }

  @Get()
  findAll(@Request() req) {
    return this.projectService.findAll(req.user.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.projectService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req,
    @Body() updateProjectDto: UpdateProjectDto,
  ) {
    return this.projectService.update(id, req.user.userId, updateProjectDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.projectService.remove(id, req.user.userId);
  }

  @Post(':id/analyze')
  analyze(@Param('id') id: string, @Request() req) {
    return this.analysisService.create(req.user.userId, { projectId: id });
  }
}
