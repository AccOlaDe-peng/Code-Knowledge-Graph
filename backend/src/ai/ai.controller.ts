import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { CreateAiApiKeyDto } from './dto/create-ai-api-key.dto';
import { CreateAiConfigDto } from './dto/create-ai-config.dto';
import { UpdateAiConfigDto } from './dto/update-ai-config.dto';
import { TriggerAiAnalysisDto } from './dto/create-ai-analysis.dto';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private aiService: AiService) {}

  // API Key 管理
  @Post('api-keys')
  async createApiKey(@Request() req, @Body() dto: CreateAiApiKeyDto) {
    return this.aiService.createApiKey(req.user.userId, dto);
  }

  @Get('api-keys')
  async getApiKeys(@Request() req) {
    return this.aiService.getUserApiKeys(req.user.userId);
  }

  @Delete('api-keys/:id')
  async deleteApiKey(@Param('id') id: string, @Request() req) {
    return this.aiService.deleteApiKey(id, req.user.userId);
  }

  // 模型管理
  @Get('providers')
  async getProviders() {
    return this.aiService.getAllProviders();
  }

  @Get('providers/:providerId/models')
  async getModels(@Param('providerId') providerId: string) {
    return this.aiService.getModelsByProvider(providerId);
  }

  // AI 分析结果查询
  @Get('analyses/projects/:projectId')
  async getProjectAnalyses(@Param('projectId') projectId: string) {
    return this.aiService.getProjectAnalyses(projectId);
  }

  @Get('analyses/projects/:projectId/files/:filePath')
  async getFileAnalyses(
    @Param('projectId') projectId: string,
    @Param('filePath') filePath: string,
  ) {
    return this.aiService.getFileAnalyses(projectId, filePath);
  }

  // 手动触发 AI 分析
  @Post('analyses/projects/:projectId/trigger')
  async triggerAnalysis(
    @Param('projectId') projectId: string,
    @Request() req,
    @Body() dto: TriggerAiAnalysisDto,
  ) {
    // 这里需要获取项目的文件节点，简化实现
    return this.aiService.triggerAiAnalysis(
      projectId,
      req.user.userId,
      [],
      dto.analysisTypes,
    );
  }

  // AI 配置管理
  @Post('configs')
  async createConfig(@Request() req, @Body() dto: CreateAiConfigDto) {
    return this.aiService.createConfig(req.user.userId, dto);
  }

  @Get('configs')
  async getConfigs(@Request() req) {
    return this.aiService.getUserConfigs(req.user.userId);
  }

  @Get('configs/active')
  async getActiveConfig(@Request() req) {
    return this.aiService.getActiveConfig(req.user.userId);
  }

  @Put('configs/:id')
  async updateConfig(
    @Param('id') id: string,
    @Request() req,
    @Body() dto: UpdateAiConfigDto,
  ) {
    return this.aiService.updateConfig(id, req.user.userId, dto);
  }

  @Put('configs/:id/activate')
  async setActiveConfig(@Param('id') id: string, @Request() req) {
    return this.aiService.setActiveConfig(id, req.user.userId);
  }

  @Delete('configs/:id')
  async deleteConfig(@Param('id') id: string, @Request() req) {
    return this.aiService.deleteConfig(id, req.user.userId);
  }
}
