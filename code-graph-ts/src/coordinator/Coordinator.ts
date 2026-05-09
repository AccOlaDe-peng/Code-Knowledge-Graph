// Coordinator — orchestrates Agent execution with auto-mode selection

import { BaseAgent } from '../agents/BaseAgent.ts';
import { AgentRunner } from '../agents/AgentRunner.ts';
import { AgentPool } from '../agents/AgentPool.ts';
import { Merger } from './Merger.ts';
import { TaskTracker } from './TaskTracker.ts';
import { AgentError, ErrorCode } from '../errors/index.ts';
import { logAnalysis, logError } from '../api/logger.ts';
import type { AgentResult, AnalyzeRequest, AnalysisDecision, Task } from './types.ts';
import type { GraphData } from '../graph/schema.ts';

// Cost tracker interface (implemented in cost/)
interface CostTracker {
  checkBudget(): boolean;
  recordUsage(agentId: string, tokens: number, model: string): void;
  getReport(): { totalTokens: number; totalCost: number; budget: number };
}

// Agent factory type
type AgentFactory = (name: string) => BaseAgent | null;

// Coordinator orchestrates the analysis pipeline
class Coordinator {
  private sessionId: string;
  private taskTracker: TaskTracker;
  private agentPool: AgentPool;
  private agentRunner: AgentRunner;
  private merger: Merger;
  private costTracker: CostTracker | null;
  private agentFactories: Map<string, AgentFactory> = new Map();
  private results: Map<string, AgentResult> = new Map();
  private pipelineAgents: string[] = [];

  constructor(
    sessionId: string,
    costTracker?: CostTracker,
  ) {
    this.sessionId = sessionId;
    this.taskTracker = new TaskTracker(sessionId);
    this.agentPool = new AgentPool();
    this.agentRunner = new AgentRunner();
    this.merger = new Merger();
    this.costTracker = costTracker ?? null;
  }

  /**
   * Register an agent factory by name
   */
  registerAgent(name: string, factory: AgentFactory): void {
    this.agentFactories.set(name, factory);
  }

  /**
   * Run analysis based on request parameters
   * Auto-decides which agents to run
   */
  async analyze(request: AnalyzeRequest): Promise<GraphData> {
    // Start task tracker
    this.taskTracker.start();

    try {
      // Decide which agents to run
      const decision = this.decideMode(request);
      this.pipelineAgents = decision.agents;
      logAnalysis(this.sessionId, 'pipeline_start', { mode: decision.mode, agents: decision.agents, reason: decision.reason });

      // Phase 1: Scanner
      logAnalysis(this.sessionId, 'file_index', { phase: 1, total: 6 });
      const scanResult = await this.runAgent('ScannerAgent', {
        id: `${this.sessionId}-scanner`,
        status: 'pending',
      });

      if (!scanResult) {
        throw new AgentError(ErrorCode.NO_FILES_FOUND, 'ScannerAgent', false);
      }
      logAnalysis(this.sessionId, 'file_index_done', { files: scanResult.nodes?.length ?? 0 });

      // Phase 2: Static + Semantic (parallel) — if applicable
      logAnalysis(this.sessionId, 'deep_analysis', { phase: 2, total: 6, parallel: true });
      const parallelPromises: Promise<AgentResult | null>[] = [];

      if (decision.agents.includes('StaticAgent')) {
        parallelPromises.push(
          this.runAgent('StaticAgent', {
            id: `${this.sessionId}-static`,
            status: 'pending',
          }),
        );
      }

      if (decision.agents.includes('SemanticAgent')) {
        parallelPromises.push(
          this.runAgent('SemanticAgent', {
            id: `${this.sessionId}-semantic`,
            status: 'pending',
          }),
        );
      }

      // Await all parallel agents
      const parallelResults = await Promise.all(parallelPromises);
      const validResults = parallelResults.filter((r): r is AgentResult => r !== null);
      logAnalysis(this.sessionId, 'deep_analysis_done', { nodes: validResults.reduce((sum, r) => sum + (r.nodes?.length ?? 0), 0) });

      // Phase 3: Merger — sync point
      logAnalysis(this.sessionId, 'merger', { phase: 3, total: 6 });
      const mergedData = this.merger.merge(validResults);
      logAnalysis(this.sessionId, 'merger_done', { nodes: mergedData.nodes.length, edges: mergedData.edges.length });

      // Phase 4: Lineage (if enabled and data available)
      let finalData = mergedData;
      if (decision.agents.includes('LineageAgent') && mergedData.nodes.length > 0) {
        logAnalysis(this.sessionId, 'data_lineage', { phase: 4, total: 6 });
        const lineageResult = await this.runAgent('LineageAgent', {
          id: `${this.sessionId}-lineage`,
          status: 'pending',
        });
        if (lineageResult) {
          // Merge lineage edges into the graph
          finalData = this.merger.mergeGraphData(finalData, {
            nodes: lineageResult.nodes,
            edges: lineageResult.edges,
          });
          logAnalysis(this.sessionId, 'data_lineage_done', { lineageEdges: lineageResult.edges?.length ?? 0 });
        }
      }

      // Phase 5: GraphBuild
      if (decision.agents.includes('GraphBuildAgent')) {
        logAnalysis(this.sessionId, 'graph_build', { phase: 5, total: 6 });
        await this.runAgent('GraphBuildAgent', {
          id: `${this.sessionId}-graphbuild`,
          status: 'pending',
        });
        logAnalysis(this.sessionId, 'graph_build_done');
      }

      // Phase 6: Report
      if (decision.agents.includes('ReportAgent')) {
        logAnalysis(this.sessionId, 'report', { phase: 6, total: 6 });
        await this.runAgent('ReportAgent', {
          id: `${this.sessionId}-report`,
          status: 'pending',
        });
        logAnalysis(this.sessionId, 'report_done');
      }

      logAnalysis(this.sessionId, 'pipeline_complete', { totalNodes: finalData.nodes.length, totalEdges: finalData.edges.length });
      return finalData;
    } finally {
      // Cleanup
      await this.agentPool.terminateAll();
      await this.taskTracker.forceFlush();
    }
  }

  /**
   * Auto-decide which agents to run based on conditions
   */
  private decideMode(request: AnalyzeRequest): AnalysisDecision {
    // Incremental update
    if (request.update) {
      return {
        mode: 'incremental',
        agents: ['ScannerAgent', 'StaticAgent', 'SemanticAgent', 'GraphBuildAgent', 'ReportAgent'],
        reason: 'Incremental update — only process changed files',
      };
    }

    // No LLM API key — static only
    if (!process.env.ANTHROPIC_API_KEY && !process.env.LLM_API_KEY && !process.env.LLM_BASE_URL) {
      return {
        mode: 'static-only',
        agents: ['ScannerAgent', 'StaticAgent', 'GraphBuildAgent', 'ReportAgent'],
        reason: 'No LLM API key — auto-degraded to static-only',
      };
    }

    // Default: full analysis
    const agents = ['ScannerAgent', 'StaticAgent', 'SemanticAgent', 'GraphBuildAgent', 'ReportAgent'];
    if (request.enableLineage) {
      agents.splice(4, 0, 'LineageAgent');
    }

    return {
      mode: 'full',
      agents,
      reason: 'Full analysis with all agents',
    };
  }

  /**
   * Run a single agent with budget check
   */
  private async runAgent(name: string, task: Task): Promise<AgentResult | null> {
    // Budget pre-check
    if (this.costTracker && !this.costTracker.checkBudget()) {
      throw new AgentError(ErrorCode.BUDGET_EXCEEDED, name, false);
    }

    const factory = this.agentFactories.get(name);
    if (!factory) {
      logAnalysis(this.sessionId, 'agent_skip', { agent: name, reason: 'not_registered' });
      return null; // Agent not registered — skip
    }

    const agent = factory(name);
    if (!agent) {
      logAnalysis(this.sessionId, 'agent_skip', { agent: name, reason: 'factory_null' });
      return null; // Factory returned null — skip
    }

    // Create task
    await this.taskTracker.createTask(task);
    await this.taskTracker.updateTask(task.id, { status: 'running', agentId: agent.id });
    logAnalysis(this.sessionId, 'agent_start', { agent: name, taskId: task.id });

    try {
      const result = await this.agentRunner.run(agent, task);

      // Track token usage
      if (this.costTracker && result.metadata.tokensUsed) {
        this.costTracker.recordUsage(
          agent.id,
          result.metadata.tokensUsed,
          agent.config.model ?? 'sonnet',
        );
      }

      await this.taskTracker.updateTask(task.id, {
        status: 'completed',
        result,
      });
      logAnalysis(this.sessionId, 'agent_complete', { agent: name, nodes: result.nodes?.length ?? 0, edges: result.edges?.length ?? 0, tokens: result.metadata.tokensUsed });

      this.results.set(name, result);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.taskTracker.updateTask(task.id, {
        status: 'failed',
        error: errorMsg,
      });
      logError(this.sessionId, error instanceof Error ? error : new Error(errorMsg), { agent: name, taskId: task.id });

      // If recoverable, continue pipeline
      if (error instanceof AgentError && error.recoverable) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Get current progress
   */
  getProgress(): Record<string, Task['status']> {
    const progress: Record<string, Task['status']> = {};
    for (const task of this.taskTracker.getAllTasks()) {
      progress[task.agentId ?? task.id] = task.status;
    }
    return progress;
  }

  /**
   * Get frontend-compatible stage progress
   */
  getStageProgress(): { step: number; total: number; stage: string; message: string } {
    const ALL_STAGES = [
      { key: 'file_index', label: '文件扫描', agent: 'ScannerAgent' },
      { key: 'deep_static_analysis', label: '静态分析', agent: 'StaticAgent' },
      { key: 'ai_semantic_enhance', label: 'AI 语义增强', agent: 'SemanticAgent' },
      { key: 'data_lineage', label: '数据血缘', agent: 'LineageAgent' },
      { key: 'graph_build', label: '图谱构建', agent: 'GraphBuildAgent' },
      { key: 'report', label: '报告生成', agent: 'ReportAgent' },
    ];

    // Filter to only include stages that are part of this pipeline
    const stages = this.pipelineAgents.length > 0
      ? ALL_STAGES.filter(s => this.pipelineAgents.includes(s.agent))
      : ALL_STAGES;

    const tasks = this.taskTracker.getAllTasks();
    const taskStatus = new Map(tasks.map(t => [t.agentId, t.status]));

    // Find current stage (first non-completed)
    let currentIdx = 0;
    for (let i = 0; i < stages.length; i++) {
      const status = taskStatus.get(stages[i].agent);
      if (!status || status === 'pending') {
        currentIdx = i;
        break;
      }
      if (status === 'running') {
        currentIdx = i;
        break;
      }
      if (status === 'failed') {
        return { step: i + 1, total: stages.length, stage: stages[i].key, message: `阶段失败: ${stages[i].label}` };
      }
      // completed — check next
      currentIdx = i + 1;
    }

    const idx = Math.min(currentIdx, stages.length - 1);
    const stage = stages[idx];

    return {
      step: currentIdx + 1,
      total: stages.length,
      stage: stage.key,
      message: `正在执行: ${stage.label}...`,
    };
  }

  /**
   * Get collected results
   */
  getResults(): Map<string, AgentResult> {
    return this.results;
  }
}

export type { CostTracker, AgentFactory };
export { Coordinator };
