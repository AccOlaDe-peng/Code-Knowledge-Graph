// Coordinator — orchestrates Agent execution with auto-mode selection

import { BaseAgent } from '../agents/BaseAgent.ts';
import { AgentRunner } from '../agents/AgentRunner.ts';
import { AgentPool } from '../agents/AgentPool.ts';
import { Merger } from './Merger.ts';
import { TaskTracker } from './TaskTracker.ts';
import { AgentError, ErrorCode } from '../errors/index.ts';
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

      // Phase 1: Scanner
      const scanResult = await this.runAgent('ScannerAgent', {
        id: `${this.sessionId}-scanner`,
        status: 'pending',
      });

      if (!scanResult) {
        throw new AgentError(ErrorCode.NO_FILES_FOUND, 'ScannerAgent', false);
      }

      // Phase 2: Static + Semantic (parallel) — if applicable
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

      // Phase 3: Merger — sync point
      const mergedData = this.merger.merge(validResults);

      // Phase 4: Lineage (if enabled and data available)
      let finalData = mergedData;
      if (decision.agents.includes('LineageAgent') && mergedData.nodes.length > 0) {
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
        }
      }

      // Phase 5: GraphBuild
      if (decision.agents.includes('GraphBuildAgent')) {
        await this.runAgent('GraphBuildAgent', {
          id: `${this.sessionId}-graphbuild`,
          status: 'pending',
        });
      }

      // Phase 6: Report
      if (decision.agents.includes('ReportAgent')) {
        await this.runAgent('ReportAgent', {
          id: `${this.sessionId}-report`,
          status: 'pending',
        });
      }

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
    if (!process.env.ANTHROPIC_API_KEY && !process.env.LLM_BASE_URL) {
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
      return null; // Agent not registered — skip
    }

    const agent = factory(name);
    if (!agent) {
      return null; // Factory returned null — skip
    }

    // Create task
    await this.taskTracker.createTask(task);
    await this.taskTracker.updateTask(task.id, { status: 'running', agentId: agent.id });

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

      this.results.set(name, result);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.taskTracker.updateTask(task.id, {
        status: 'failed',
        error: errorMsg,
      });

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
   * Get collected results
   */
  getResults(): Map<string, AgentResult> {
    return this.results;
  }
}

export type { CostTracker, AgentFactory };
export { Coordinator };
