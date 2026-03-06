import { Module, forwardRef } from '@nestjs/common';
import { GraphController } from './graph.controller';
import { GraphService } from './graph.service';
import { ProjectModule } from '../project/project.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    forwardRef(() => ProjectModule),
    forwardRef(() => AiModule),
  ],
  controllers: [GraphController],
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
