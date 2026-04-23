// ForkAgent — forked child agent

import { BaseAgent, type Tool } from './BaseAgent.ts';
import type { AgentConfig, AgentResult, Task } from '../coordinator/types.ts';
import type { AgentContext } from './AgentContext.ts';

// Fork configuration
interface ForkConfig {
  maxConcurrency: number;   // Default 5
  timeoutMs: number;        // Default 60000
  retryLimit: number;       // Default 1
}

const DEFAULT_FORK_CONFIG: ForkConfig = {
  maxConcurrency: 5,
  timeoutMs: 60000,
  retryLimit: 1,
};

// Forked agent inherits parent context and tool pool (read-only)
class ForkAgent extends BaseAgent {
  readonly parentAgentId: string;
  readonly forkConfig: ForkConfig;
  private terminated: boolean = false;

  constructor(
    id: string,
    config: AgentConfig,
    context: AgentContext,
    tools: Tool[],
    parentAgentId: string,
    forkConfig?: Partial<ForkConfig>,
  ) {
    super(id, config, context, tools);
    this.parentAgentId = parentAgentId;
    this.forkConfig = { ...DEFAULT_FORK_CONFIG, ...forkConfig };
  }

  async execute(task: Task): Promise<AgentResult> {
    if (this.terminated) {
      throw new Error(`ForkAgent '${this.id}' has been terminated`);
    }

    await this.onTaskStart(task);

    try {
      // Execute with timeout
      const result = await Promise.race([
        this.doWork(task),
        this.createTimeoutPromise(),
      ]);

      await this.onTaskComplete(result);
      this.notifyComplete();
      return result;
    } catch (error) {
      await this.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  // Subclasses implement actual work
  protected async doWork(_task: Task): Promise<AgentResult> {
    throw new Error('ForkAgent.doWork must be implemented by subclass');
  }

  private createTimeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`ForkAgent '${this.id}' timed out after ${this.forkConfig.timeoutMs}ms`));
      }, this.forkConfig.timeoutMs);
    });
  }

  override terminate(): Promise<void> {
    this.terminated = true;
    this.notifyComplete();
    return Promise.resolve();
  }

  // Hooks — subclasses override
  override onTaskStart(_task: Task): Promise<void> {
    return Promise.resolve();
  }

  override onTaskComplete(_result: AgentResult): Promise<void> {
    return Promise.resolve();
  }

  override onError(_error: Error): Promise<void> {
    return Promise.resolve();
  }
}

export type { ForkConfig };
export { ForkAgent, DEFAULT_FORK_CONFIG };
