import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiModelProvider } from './entities/ai-model-provider.entity';
import { AiModel } from './entities/ai-model.entity';

const PROVIDERS = [
  {
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    description: 'OpenAI GPT 系列模型',
    models: [
      { modelName: 'gpt-4o', displayName: 'GPT-4o', maxTokens: 4096, contextWindow: 128000, pricing: 0.005 },
      { modelName: 'gpt-4o-mini', displayName: 'GPT-4o Mini', maxTokens: 4096, contextWindow: 128000, pricing: 0.00015 },
      { modelName: 'gpt-4-turbo', displayName: 'GPT-4 Turbo', maxTokens: 4096, contextWindow: 128000, pricing: 0.01 },
    ],
  },
  {
    name: 'claude',
    displayName: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    description: 'Anthropic Claude 系列模型',
    models: [
      { modelName: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', maxTokens: 8192, contextWindow: 200000, pricing: 0.003 },
      { modelName: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', maxTokens: 4096, contextWindow: 200000, pricing: 0.00025 },
    ],
  },
  {
    name: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    description: 'DeepSeek 系列模型',
    models: [
      { modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', maxTokens: 4096, contextWindow: 64000, pricing: 0.00014 },
      { modelName: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner', maxTokens: 8192, contextWindow: 64000, pricing: 0.00055 },
    ],
  },
  {
    name: 'glm',
    displayName: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    description: '智谱 AI GLM 系列模型',
    models: [
      { modelName: 'glm-4-flash', displayName: 'GLM-4 Flash', maxTokens: 4096, contextWindow: 128000, pricing: 0.0001 },
      { modelName: 'glm-4-plus', displayName: 'GLM-4 Plus', maxTokens: 4096, contextWindow: 128000, pricing: 0.05 },
    ],
  },
  {
    name: 'minimax',
    displayName: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    description: 'MiniMax 系列模型',
    models: [
      { modelName: 'MiniMax-Text-01', displayName: 'MiniMax-Text-01', maxTokens: 8192, contextWindow: 1000000, pricing: 0.001 },
      { modelName: 'abab6.5s-chat', displayName: 'abab6.5s Chat', maxTokens: 8192, contextWindow: 245760, pricing: 0.0001 },
      { modelName: 'abab6.5-chat', displayName: 'abab6.5 Chat', maxTokens: 8192, contextWindow: 245760, pricing: 0.001 },
    ],
  },
];

@Injectable()
export class AiSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiSeedService.name);

  constructor(
    @InjectRepository(AiModelProvider)
    private providerRepository: Repository<AiModelProvider>,
    @InjectRepository(AiModel)
    private modelRepository: Repository<AiModel>,
  ) {}

  async onApplicationBootstrap() {
    await this.seedProvidersAndModels();
  }

  private async seedProvidersAndModels() {
    for (const providerData of PROVIDERS) {
      const { models, ...providerFields } = providerData;

      let provider = await this.providerRepository.findOne({
        where: { name: providerFields.name },
      });

      if (!provider) {
        provider = await this.providerRepository.save(
          this.providerRepository.create(providerFields),
        );
        this.logger.log(`Seeded provider: ${provider.displayName}`);
      }

      for (const modelData of models) {
        const exists = await this.modelRepository.findOne({
          where: { providerId: provider.id, modelName: modelData.modelName },
        });

        if (!exists) {
          await this.modelRepository.save(
            this.modelRepository.create({ ...modelData, providerId: provider.id }),
          );
          this.logger.log(`Seeded model: ${modelData.displayName}`);
        }
      }
    }
  }
}
