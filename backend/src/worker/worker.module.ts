import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { WorkerService } from './worker.service';
import { CodeAnalyzerService } from './code-analyzer.service';
import { Repository } from '../repository/repository.entity';
import { AnalysisTask } from '../analysis/analysis-task.entity';
import { AnalysisModule } from '../analysis/analysis.module';
import { GraphModule } from '../graph/graph.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Repository, AnalysisTask]),
    BullModule.registerQueueAsync({
      name: 'analysis',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST'),
          port: configService.get('REDIS_PORT'),
          password: configService.get('REDIS_PASSWORD') || undefined,
          connectTimeout: 5000,
          retryStrategy: (times) => {
            if (times > 3) {
              return null; // 停止重试
            }
            return Math.min(times * 100, 2000);
          },
        },
      }),
    }),
    forwardRef(() => AnalysisModule),
    GraphModule,
  ],
  providers: [WorkerService, CodeAnalyzerService],
  exports: [WorkerService, CodeAnalyzerService],
})
export class WorkerModule {}
