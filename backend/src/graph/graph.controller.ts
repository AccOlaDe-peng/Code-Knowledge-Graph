import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { GraphService } from './graph.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectService } from '../project/project.service';
import { AiService } from '../ai/ai.service';
import { AiAnalysis, AiAnalysisType } from '../ai/entities/ai-analysis.entity';

const DOMAIN_RULES: Array<{ pattern: RegExp; name: string; color: string }> = [
  { pattern: /auth|login|jwt|token|password|session|oauth/i, name: '认证鉴权', color: '#f85149' },
  { pattern: /database|repository|entity|migration|orm|typeorm|prisma|dao/i, name: '数据存储', color: '#e3b341' },
  { pattern: /api|controller|route|endpoint|request|response/i, name: 'API 层', color: '#58a6ff' },
  { pattern: /worker|queue|job|task|schedule|processor|bull|cron/i, name: '任务调度', color: '#bc8cff' },
  { pattern: /graph|neo4j|cypher/i, name: '图数据库', color: '#3fb950' },
];
const DEFAULT_DOMAIN = { name: '业务逻辑', color: '#8b949e' };

@Controller('graph')
@UseGuards(JwtAuthGuard)
export class GraphController {
  constructor(
    private graphService: GraphService,
    private projectService: ProjectService,
    private aiService: AiService,
  ) {}

  @Get('projects/:projectId')
  async getProjectGraph(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);

    return this.graphService.getProjectGraph(projectId);
  }

  @Get('projects/:projectId/files/:filePath/dependencies')
  async getFileDependencies(
    @Param('projectId') projectId: string,
    @Param('filePath') filePath: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);

    return this.graphService.getFileDependencies(projectId, filePath);
  }

  @Get('projects/:projectId/files/:filePath/references')
  async getFileReferences(
    @Param('projectId') projectId: string,
    @Param('filePath') filePath: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);

    return this.graphService.getFileReferences(projectId, filePath);
  }

  @Get('projects/:projectId/circular-dependencies')
  async findCircularDependencies(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);

    return this.graphService.findCircularDependencies(projectId);
  }

  @Get('projects/:projectId/functions/:functionName/call-chain')
  async getFunctionCallChain(
    @Param('projectId') projectId: string,
    @Param('functionName') functionName: string,
    @Query('depth') depth: number = 3,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);

    return this.graphService.getFunctionCallChain(
      projectId,
      functionName,
      depth,
    );
  }

  // 数据血缘图
  @Get('projects/:projectId/data-lineage')
  async getDataLineage(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);
    return this.graphService.getDataLineageGraph(projectId);
  }

  // 业务流程图
  @Get('projects/:projectId/business-flow')
  async getBusinessFlow(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);
    return this.graphService.getBusinessFlowGraph(projectId);
  }

  // AI 语义图谱
  @Get('projects/:projectId/semantic-graph')
  async getSemanticGraph(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);
    const graphData = await this.graphService.getProjectGraph(projectId);
    const analyses = await this.aiService.getProjectAnalyses(projectId);
    return this.buildSemanticGraph(graphData, analyses);
  }

  private buildSemanticGraph(
    graphData: Array<{ file: string; imports: string[] }>,
    analyses: AiAnalysis[],
  ) {
    // 建立 filePath → 最新 code_summary 的映射
    const analysisMap = new Map<string, AiAnalysis>();
    for (const a of analyses) {
      if (a.analysisType === AiAnalysisType.CODE_SUMMARY && !analysisMap.has(a.filePath)) {
        analysisMap.set(a.filePath, a);
      }
    }
    const hasAiData = analysisMap.size > 0;

    // 为每个文件确定所属语义域
    const fileDomainMap = new Map<string, { name: string; color: string }>();
    const domainMap = new Map<string, { name: string; color: string; files: string[] }>();

    for (const { file } of graphData) {
      if (!file) continue;
      const analysis = analysisMap.get(file);
      const textToMatch = [
        analysis?.summary || '',
        (analysis?.analysisJson as any)?.businessLogic || '',
        ((analysis?.analysisJson as any)?.designPatterns || []).join(' '),
        ((analysis?.analysisJson as any)?.keyComponents || []).map((c: any) => c?.name || '').join(' '),
        file,
      ].join(' ');

      let assigned = DEFAULT_DOMAIN;
      for (const rule of DOMAIN_RULES) {
        if (rule.pattern.test(textToMatch)) {
          assigned = rule;
          break;
        }
      }

      fileDomainMap.set(file, assigned);
      if (!domainMap.has(assigned.name)) {
        domainMap.set(assigned.name, { ...assigned, files: [] });
      }
      domainMap.get(assigned.name)!.files.push(file);
    }

    // 构造节点和边
    const nodes: Array<{ id: string; label: string; nodeType: 'domain' | 'file'; color: string }> = [];
    const edges: Array<{ id: string; source: string; target: string; edgeType: string }> = [];
    let edgeIdx = 0;

    for (const [domainName, domain] of domainMap) {
      const domainId = `domain:${domainName}`;
      nodes.push({ id: domainId, label: domainName, nodeType: 'domain', color: domain.color });
      for (const filePath of domain.files) {
        nodes.push({
          id: filePath,
          label: filePath.split('/').pop() || filePath,
          nodeType: 'file',
          color: '#484f58',
        });
        edges.push({
          id: `bt-${edgeIdx++}`,
          source: filePath,
          target: domainId,
          edgeType: 'belongs_to',
        });
      }
    }

    // IMPORTS 边
    for (const { file, imports } of graphData) {
      if (!file) continue;
      for (const imp of imports) {
        if (imp) {
          edges.push({
            id: `imp-${edgeIdx++}`,
            source: file,
            target: imp,
            edgeType: 'imports',
          });
        }
      }
    }

    return {
      hasAiData,
      domains: Array.from(domainMap.values()).map(d => ({ name: d.name, color: d.color, fileCount: d.files.length })),
      nodes,
      edges,
    };
  }

  @Delete('projects/:projectId')
  async deleteProjectGraph(
    @Param('projectId') projectId: string,
    @Request() req,
  ) {
    await this.projectService.findOne(projectId, req.user.userId);

    await this.graphService.deleteProjectGraph(projectId);

    return { message: 'Project graph deleted successfully' };
  }
}
