import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { AiModelProvider } from './entities/ai-model-provider.entity';
import { AiModel } from './entities/ai-model.entity';
import { AiApiKey, ApiKeyStatus } from './entities/ai-api-key.entity';
import { AiAnalysis, AiAnalysisType, AiAnalysisStatus } from './entities/ai-analysis.entity';
import { AiConfig } from './entities/ai-config.entity';
import { CreateAiApiKeyDto } from './dto/create-ai-api-key.dto';
import { CreateAiConfigDto } from './dto/create-ai-config.dto';
import { UpdateAiConfigDto } from './dto/update-ai-config.dto';
import { BaseModelAdapter } from './adapters/base-model.adapter';
import { OpenAIAdapter } from './adapters/openai.adapter';
import { ClaudeAdapter } from './adapters/claude.adapter';
import { DeepSeekAdapter } from './adapters/deepseek.adapter';
import { GLMAdapter } from './adapters/glm.adapter';
import { MiniMaxAdapter } from './adapters/minimax.adapter';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @InjectRepository(AiModelProvider)
    private providerRepository: Repository<AiModelProvider>,
    @InjectRepository(AiModel)
    private modelRepository: Repository<AiModel>,
    @InjectRepository(AiApiKey)
    private apiKeyRepository: Repository<AiApiKey>,
    @InjectRepository(AiAnalysis)
    private analysisRepository: Repository<AiAnalysis>,
    @InjectRepository(AiConfig)
    private configRepository: Repository<AiConfig>,
    @InjectQueue('ai-analysis')
    private aiAnalysisQueue: Queue,
  ) {}

  // API Key 管理
  async createApiKey(userId: string, dto: CreateAiApiKeyDto) {
    const apiKey = this.apiKeyRepository.create({
      userId,
      providerId: dto.providerId,
      apiKey: dto.apiKey, // TODO: 加密存储
      keyName: dto.keyName,
      baseUrl: dto.baseUrl,
      status: dto.status || ApiKeyStatus.ACTIVE,
    });

    return this.apiKeyRepository.save(apiKey);
  }

  async getUserApiKeys(userId: string) {
    return this.apiKeyRepository.find({
      where: { userId },
      relations: ['provider'],
    });
  }

  async deleteApiKey(id: string, userId: string) {
    const apiKey = await this.apiKeyRepository.findOne({
      where: { id, userId },
    });

    if (!apiKey) {
      throw new NotFoundException('API Key not found');
    }

    await this.apiKeyRepository.remove(apiKey);
    return { success: true };
  }

  async userHasApiKey(userId: string): Promise<boolean> {
    const count = await this.apiKeyRepository.count({
      where: { userId, status: ApiKeyStatus.ACTIVE },
    });
    return count > 0;
  }

  // 模型管理
  async getAllProviders() {
    return this.providerRepository.find({
      where: { enabled: true },
      relations: ['models'],
    });
  }

  async getModelsByProvider(providerId: string) {
    return this.modelRepository.find({
      where: { providerId, enabled: true },
    });
  }

  async getUserPreferredModel(userId: string): Promise<AiModel> {
    // 获取用户的第一个可用 API Key 对应的模型
    const apiKey = await this.apiKeyRepository.findOne({
      where: { userId, status: ApiKeyStatus.ACTIVE },
      relations: ['provider', 'provider.models'],
    });

    if (!apiKey || !apiKey.provider.models.length) {
      throw new Error('No available AI model for user');
    }

    return apiKey.provider.models[0];
  }

  // AI 分析
  async triggerAiAnalysis(
    projectId: string,
    userId: string,
    fileNodes: any[],
    analysisTypes: AiAnalysisType[],
  ) {
    await this.aiAnalysisQueue.add('analyze-project-ai', {
      projectId,
      userId,
      fileNodes,
      analysisTypes,
    });

    return { success: true, message: 'AI analysis triggered' };
  }

  async saveAnalysis(
    projectId: string,
    filePath: string,
    analysisType: AiAnalysisType,
    modelId: string,
    parsedResult: any,
    promptTokens: number,
    completionTokens: number,
  ) {
    const analysis = this.analysisRepository.create({
      projectId,
      filePath,
      analysisType,
      modelId,
      status: AiAnalysisStatus.COMPLETED,
      summary: parsedResult.summary || '',
      riskLevel: parsedResult.overallRiskLevel || null,
      techDebtScore: parsedResult.qualityScore || null,
      analysisJson: parsedResult,
      promptTokens,
      completionTokens,
    });

    return this.analysisRepository.save(analysis);
  }

  async getProjectAnalyses(projectId: string) {
    return this.analysisRepository.find({
      where: { projectId },
      relations: ['model', 'model.provider'],
      order: { createdAt: 'DESC' },
    });
  }

  async getFileAnalyses(projectId: string, filePath: string) {
    return this.analysisRepository.find({
      where: { projectId, filePath },
      relations: ['model', 'model.provider'],
      order: { createdAt: 'DESC' },
    });
  }

  // 获取 Model Adapter
  getAdapter(providerName: string, apiKey: string, baseUrl: string): BaseModelAdapter {
    switch (providerName) {
      case 'openai':
        return new OpenAIAdapter(apiKey, baseUrl);
      case 'claude':
        return new ClaudeAdapter(apiKey, baseUrl);
      case 'deepseek':
        return new DeepSeekAdapter(apiKey);
      case 'glm':
        return new GLMAdapter(apiKey);
      case 'minimax':
        return new MiniMaxAdapter(apiKey, baseUrl);
      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  }

  async getUserApiKeyForProvider(userId: string, providerId: string): Promise<AiApiKey> {
    const apiKey = await this.apiKeyRepository.findOne({
      where: { userId, providerId, status: ApiKeyStatus.ACTIVE },
      relations: ['provider'],
    });

    if (!apiKey) {
      throw new Error(`No active API key found for provider: ${providerId}`);
    }

    return apiKey;
  }

  // AI 配置管理
  async createConfig(userId: string, dto: CreateAiConfigDto) {
    // 验证 provider 和 model 是否存在
    const provider = await this.providerRepository.findOne({
      where: { id: dto.providerId },
    });
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    const model = await this.modelRepository.findOne({
      where: { id: dto.modelId, providerId: dto.providerId },
    });
    if (!model) {
      throw new NotFoundException('Model not found or does not belong to this provider');
    }

    const config = this.configRepository.create({
      userId,
      configName: dto.configName,
      providerId: dto.providerId,
      modelId: dto.modelId,
      apiKey: dto.apiKey, // TODO: 加密存储
      baseUrl: dto.baseUrl,
      isActive: false,
    });

    return this.configRepository.save(config);
  }

  async getUserConfigs(userId: string) {
    return this.configRepository.find({
      where: { userId },
      relations: ['provider', 'model'],
      order: { createdAt: 'DESC' },
    });
  }

  async updateConfig(id: string, userId: string, dto: UpdateAiConfigDto) {
    const config = await this.configRepository.findOne({
      where: { id, userId },
    });

    if (!config) {
      throw new NotFoundException('Config not found');
    }

    // 如果更新了 provider 或 model，需要验证
    if (dto.providerId || dto.modelId) {
      const providerId = dto.providerId || config.providerId;
      const modelId = dto.modelId || config.modelId;

      const model = await this.modelRepository.findOne({
        where: { id: modelId, providerId },
      });
      if (!model) {
        throw new BadRequestException('Model does not belong to this provider');
      }
    }

    Object.assign(config, dto);
    return this.configRepository.save(config);
  }

  async deleteConfig(id: string, userId: string) {
    const config = await this.configRepository.findOne({
      where: { id, userId },
    });

    if (!config) {
      throw new NotFoundException('Config not found');
    }

    await this.configRepository.remove(config);
    return { success: true };
  }

  async setActiveConfig(id: string, userId: string) {
    const config = await this.configRepository.findOne({
      where: { id, userId },
    });

    if (!config) {
      throw new NotFoundException('Config not found');
    }

    // 将该用户的所有配置设置为非活跃
    await this.configRepository.update(
      { userId },
      { isActive: false },
    );

    // 设置当前配置为活跃
    config.isActive = true;
    return this.configRepository.save(config);
  }

  async getActiveConfig(userId: string): Promise<AiConfig | null> {
    return this.configRepository.findOne({
      where: { userId, isActive: true },
      relations: ['provider', 'model'],
    });
  }
}
