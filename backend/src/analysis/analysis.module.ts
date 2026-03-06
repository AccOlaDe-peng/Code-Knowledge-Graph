import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { AnalysisProcessor } from './analysis.processor';
import { AnalysisTask } from './analysis-task.entity';
import { ProjectModule } from '../project/project.module';
import { WorkerModule } from '../worker/worker.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AnalysisTask]),
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
    forwardRef(() => ProjectModule),
    forwardRef(() => WorkerModule),
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService, AnalysisProcessor],
  exports: [AnalysisService],
})
export class AnalysisModule {}
