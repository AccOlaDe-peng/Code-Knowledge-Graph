import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiSeedService } from './ai-seed.service';
import { AiModelProvider } from './entities/ai-model-provider.entity';
import { AiModel } from './entities/ai-model.entity';
import { AiApiKey } from './entities/ai-api-key.entity';
import { AiAnalysis } from './entities/ai-analysis.entity';
import { AiConfig } from './entities/ai-config.entity';
import { AiAnalysisProcessor } from './processors/ai-analysis.processor';
import { PromptBuilderService } from './prompts/prompt-builder.service';
import { ResponseParserService } from './parsers/response-parser.service';
import { AiGraphBuilderService } from './graph/ai-graph-builder.service';
import { GraphModule } from '../graph/graph.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiModelProvider,
      AiModel,
      AiApiKey,
      AiAnalysis,
      AiConfig,
    ]),
    BullModule.registerQueue({
      name: 'ai-analysis',
    }),
    forwardRef(() => GraphModule),
  ],
  controllers: [AiController],
  providers: [
    AiService,
    AiSeedService,
    AiAnalysisProcessor,
    PromptBuilderService,
    ResponseParserService,
    AiGraphBuilderService,
  ],
  exports: [AiService],
})
export class AiModule {}
