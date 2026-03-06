import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { CreateAnalysisTaskDto } from './dto/create-analysis-task.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('analysis')
@UseGuards(JwtAuthGuard)
export class AnalysisController {
  constructor(private analysisService: AnalysisService) {}

  @Post('tasks')
  create(@Request() req, @Body() createAnalysisTaskDto: CreateAnalysisTaskDto) {
    return this.analysisService.create(req.user.userId, createAnalysisTaskDto);
  }

  @Get('tasks')
  findAll(@Request() req, @Query('projectId') projectId?: string) {
    return this.analysisService.findAll(req.user.userId, projectId);
  }

  @Get('tasks/:id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.analysisService.findOne(id, req.user.userId);
  }
}
