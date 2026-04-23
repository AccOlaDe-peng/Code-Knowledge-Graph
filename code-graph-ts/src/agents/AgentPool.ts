// AgentPool — manages fork lifecycle with concurrency limits and timeouts

import { BaseAgent, type Tool } from './BaseAgent.ts';
import { ForkAgent, type ForkConfig, DEFAULT_FORK_CONFIG } from './ForkAgent.ts';
import type { AgentConfig } from '../coordinator/types.ts';
import type { AgentContext } from './AgentContext.ts';

// Fork request for queue
interface ForkRequest {
  resolve: () => void;
  parent: BaseAgent;
  config: Partial<AgentConfig>;
  forkConfig?: Partial<ForkConfig>;
}

// Pool manages forked agents with concurrency limits
class AgentPool {
  private active: Set<string> = new Set();
  private queue: ForkRequest[] = [];
  private forkedAgents: Map<string, ForkAgent> = new Map();
  private forkCounter: number = 0;

  /**
   * Create a forked agent with concurrency control
   * - Waits if maxConcurrency is reached
   * - Sets up timeout protection
   * - Registers cleanup callbacks
   */
  async fork(
    parent: BaseAgent,
    config: Partial<AgentConfig>,
    forkConfig?: Partial<ForkConfig>,
  ): Promise<ForkAgent> {
    const fc = { ...DEFAULT_FORK_CONFIG, ...forkConfig };

    // Backpressure: wait if at capacity
    if (this.active.size >= fc.maxConcurrency) {
      await new Promise<void>(resolve => {
        this.queue.push({ resolve, parent, config, forkConfig });
      });
    }

    // Generate unique ID
    const forkId = `${parent.id}-fork-${++this.forkCounter}`;

    // Create forked agent
    const mergedConfig: AgentConfig = {
      ...parent.config,
      ...config,
      name: config.name ?? `${parent.config.name}-fork`,
    };

    const forked = new ForkAgent(
      forkId,
      mergedConfig,
      parent.getContext(),  // Inherit read-only context
      parent.getTools(),    // Inherit tool pool
      parent.id,
      forkConfig,
    );

    this.active.add(forkId);
    this.forkedAgents.set(forkId, forked);

    // Setup cleanup on completion
    forked.onComplete(() => {
      this.active.delete(forkId);
      // Wake up next in queue
      const next = this.queue.shift();
      if (next) {
        next.resolve();
      }
    });

    return forked;
  }

  /**
   * Get active fork count
   */
  get activeCount(): number {
    return this.active.size;
  }

  /**
   * Get queued fork count
   */
  get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Get a forked agent by ID
   */
  getFork(id: string): ForkAgent | undefined {
    return this.forkedAgents.get(id);
  }

  /**
   * Terminate a specific forked agent
   */
  async terminateFork(id: string): Promise<void> {
    const agent = this.forkedAgents.get(id);
    if (agent) {
      await agent.terminate();
      this.forkedAgents.delete(id);
      this.active.delete(id);
    }
  }

  /**
   * Terminate all active forked agents (for Coordinator shutdown)
   */
  async terminateAll(): Promise<void> {
    const terminations: Promise<void>[] = [];

    for (const id of this.active) {
      const agent = this.forkedAgents.get(id);
      if (agent) {
        terminations.push(agent.terminate());
      }
    }

    await Promise.all(terminations);

    // Release all queued waiters
    for (const req of this.queue) {
      req.resolve();
    }

    this.queue = [];
    this.forkedAgents.clear();
    this.active.clear();
  }

  /**
   * Clear the queue without starting new forks
   */
  clearQueue(): void {
    for (const req of this.queue) {
      req.resolve();
    }
    this.queue = [];
  }
}

export type { ForkRequest };
export { AgentPool };
