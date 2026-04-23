// BaseAgent — abstract base class for all agents

import type { AgentConfig, AgentResult, Task, Message } from '../coordinator/types.ts';
import type { AgentContext } from './AgentContext.ts';

// Tool interface
interface Tool {
  name: string;
  execute: (...args: unknown[]) => Promise<unknown>;
}

// Abstract base class for agents
abstract class BaseAgent {
  readonly id: string;
  readonly config: AgentConfig;
  protected context: AgentContext;
  protected toolPool: Map<string, Tool>;
  private onCompleteCallbacks: Set<() => void> = new Set();

  constructor(id: string, config: AgentConfig, context: AgentContext, tools: Tool[] = []) {
    this.id = id;
    this.config = config;
    this.context = context;
    this.toolPool = new Map(tools.map(t => [t.name, t]));
  }

  // Lifecycle methods
  async initialize(): Promise<void> {
    // Override in subclass if needed
  }

  async terminate(): Promise<void> {
    // Override in subclass if needed
    this.onCompleteCallbacks.clear();
  }

  // Execute a task — returns independent result, no shared writes
  abstract execute(task: Task): Promise<AgentResult>;

  // Hooks for subclasses
  abstract onTaskStart(task: Task): Promise<void>;
  abstract onTaskComplete(result: AgentResult): Promise<void>;
  abstract onError(error: Error): Promise<void>;

  // Communication
  async sendMessage(to: string, message: Message): Promise<void> {
    // Communication is handled by Coordinator
    // This is a hook for agents to emit messages
    throw new Error('sendMessage must be implemented by Coordinator-aware wrapper');
  }

  async receiveMessage(from: string, message: Message): Promise<void> {
    // Override in subclass to handle incoming messages
  }

  // Tool access
  protected getTool(name: string): Tool | undefined {
    if (this.config.disallowedTools?.includes(name)) {
      throw new Error(`Tool '${name}' is disallowed for agent '${this.id}'`);
    }
    return this.toolPool.get(name);
  }

  protected async useTool(name: string, ...args: unknown[]): Promise<unknown> {
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found for agent '${this.id}'`);
    }
    return tool.execute(...args);
  }

  // Public read-only access for AgentPool (forking needs context + tools)
  getContext(): AgentContext {
    return this.context;
  }

  getTools(): Tool[] {
    return [...this.toolPool.values()];
  }

  // Completion callbacks (for AgentPool)
  onComplete(callback: () => void): void {
    this.onCompleteCallbacks.add(callback);
  }

  protected notifyComplete(): void {
    for (const cb of this.onCompleteCallbacks) {
      cb();
    }
  }

  // Helper to create standard result
  protected createResult(
    nodes: AgentResult['nodes'],
    edges: AgentResult['edges'],
    metadata: AgentResult['metadata'],
  ): AgentResult {
    return {
      agentId: this.id,
      nodes,
      edges,
      metadata,
    };
  }
}

export type { Tool };
export { BaseAgent };
