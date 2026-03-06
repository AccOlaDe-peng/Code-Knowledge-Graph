import { Module, forwardRef } from '@nestjs/common';
import { GraphController } from './graph.controller';
import { GraphService } from './graph.service';
import { ProjectModule } from '../project/project.module';

@Module({
  imports: [forwardRef(() => ProjectModule)],
  controllers: [GraphController],
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
