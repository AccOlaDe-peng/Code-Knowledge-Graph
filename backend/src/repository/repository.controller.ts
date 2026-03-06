import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RepositoryService } from './repository.service';
import { CreateRepositoryDto } from './dto/create-repository.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('repositories')
@UseGuards(JwtAuthGuard)
export class RepositoryController {
  constructor(private repositoryService: RepositoryService) {}

  @Post()
  create(@Request() req, @Body() createRepositoryDto: CreateRepositoryDto) {
    return this.repositoryService.create(
      req.user.userId,
      createRepositoryDto,
    );
  }

  @Get('project/:projectId')
  findByProject(@Param('projectId') projectId: string, @Request() req) {
    return this.repositoryService.findByProject(projectId, req.user.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.repositoryService.findOne(id, req.user.userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.repositoryService.remove(id, req.user.userId);
  }

  @Get('oauth/github/url')
  getGithubAuthUrl(@Query('projectId') projectId: string, @Request() req) {
    return {
      url: this.repositoryService.getGithubAuthUrl(projectId, req.user.userId),
    };
  }

  @Get('oauth/gitlab/url')
  getGitlabAuthUrl(@Query('projectId') projectId: string, @Request() req) {
    return {
      url: this.repositoryService.getGitlabAuthUrl(projectId, req.user.userId),
    };
  }

  @Post('upload/zip')
  @UseInterceptors(FileInterceptor('file'))
  async uploadZip(
    @Request() req,
    @Body('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.repositoryService.createFromZip(
      req.user.userId,
      projectId,
      file,
    );
  }
}
