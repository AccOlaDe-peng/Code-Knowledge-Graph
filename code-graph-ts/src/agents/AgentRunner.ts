// AgentRunner — execution engine with error handling, timeout, and retry

import { BaseAgent } from './BaseAgent.ts';
import { AgentError, ErrorCode } from '../errors/index.ts';
import type { AgentResult, Task } from '../coordinator/types.ts';

// Progress event emitted during execution
interface ProgressEvent {
  agentId: string;
  taskId: string;
  type: 'started' | 'progress' | 'completed' | 'failed';
  data?: unknown;
}

type ProgressCallback = (event: ProgressEvent) => void;

// Runner configuration
interface RunnerConfig {
  timeoutMs: number;     // Default 300000 (5 min)
  retryLimit: number;    // Default 1
  retryDelayMs: number;  // Default 1000
}

const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  timeoutMs: 300000,
  retryLimit: 1,
  retryDelayMs: 1000,
};

// Agent execution engine
class AgentRunner {
  private config: RunnerConfig;
  private progressCallbacks: Set<ProgressCallback> = new Set();

  constructor(config?: Partial<RunnerConfig>) {
    this.config = { ...DEFAULT_RUNNER_CONFIG, ...config };
  }

  // Subscribe to progress events
  onProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }

  // Execute an agent with timeout and retry
  async run(agent: BaseAgent, task: Task): Promise<AgentResult> {
    let lastError: Error | undefined;
    let attempts = 0;

    while (attempts <= this.config.retryLimit) {
      try {
        this.emitProgress({
          agentId: agent.id,
          taskId: task.id,
          type: 'started',
        });

        const result = await this.executeWithTimeout(agent, task);

        this.emitProgress({
          agentId: agent.id,
          taskId: task.id,
          type: 'completed',
          data: { nodeCount: result.nodes.length, edgeCount: result.edges.length },
        });

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempts++;

        // Check if recoverable
        if (lastError instanceof AgentError && !lastError.recoverable) {
          this.emitProgress({
            agentId: agent.id,
            taskId: task.id,
            type: 'failed',
            data: { error: lastError.message, recoverable: false },
          });
          throw lastError;
        }

        // Rate limit: wait before retry
        if (lastError instanceof AgentError && lastError.code === ErrorCode.LLM_RATE_LIMIT) {
          await this.delay(this.config.retryDelayMs * attempts);
        } else if (attempts <= this.config.retryLimit) {
          await this.delay(this.config.retryDelayMs);
        }
      }
    }

    // All retries exhausted
    this.emitProgress({
      agentId: agent.id,
      taskId: task.id,
      type: 'failed',
      data: { error: lastError?.message, attempts },
    });

    throw lastError ?? new Error(`Agent '${agent.id}' failed after ${attempts} attempts`);
  }

  // Execute with timeout
  private async executeWithTimeout(agent: BaseAgent, task: Task): Promise<AgentResult> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new AgentError(ErrorCode.TIMEOUT, agent.id, true));
      }, this.config.timeoutMs);
    });

    return Promise.race([
      agent.execute(task),
      timeoutPromise,
    ]);
  }

  private emitProgress(event: ProgressEvent): void {
    for (const cb of this.progressCallbacks) {
      try {
        cb(event);
      } catch {
        // Don't let callback errors propagate
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export type { ProgressEvent, ProgressCallback, RunnerConfig };
export { AgentRunner, DEFAULT_RUNNER_CONFIG };
