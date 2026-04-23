// CostTracker — token budget tracking per agent

import { AgentError } from '../errors/index.ts';

// Model pricing (per 1K tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  opus: { input: 0.015, output: 0.075 },
  sonnet: { input: 0.003, output: 0.015 },
  haiku: { input: 0.00025, output: 0.00125 },
} as const;

interface AgentUsage {
  tokens: number;
  cost: number;
}

interface CostTrackerState {
  sessionId: string;
  totalTokens: number;
  totalCost: number;
  budget: number;
  byAgent: Map<string, AgentUsage>;
}

/**
 * CostTracker enforces LLM budget and tracks per-agent usage.
 */
class CostTracker {
  private state: CostTrackerState;

  constructor(sessionId: string, budget: number = 10.0) {
    this.state = {
      sessionId,
      totalTokens: 0,
      totalCost: 0,
      budget,
      byAgent: new Map(),
    };
  }

  /**
   * Check if budget has room for more calls
   */
  checkBudget(): boolean {
    return this.state.totalCost < this.state.budget;
  }

  /**
   * Record token usage from an agent
   * Throws AgentError if budget exceeded
   */
  recordUsage(agentId: string, tokens: number, model: string): void {
    const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['sonnet']!;

    // Assume 50/50 input/output split for estimate
    const avgPrice = (pricing.input + pricing.output) / 2;
    const cost = (tokens * avgPrice) / 1000;

    // Check budget before recording
    if (this.state.totalCost + cost > this.state.budget) {
      throw new AgentError(
        'BUDGET_EXCEEDED',
        agentId,
        false,
        { totalCost: this.state.totalCost, cost, budget: this.state.budget },
      );
    }

    this.state.totalTokens += tokens;
    this.state.totalCost += cost;

    // Track per-agent
    const existing = this.state.byAgent.get(agentId) ?? { tokens: 0, cost: 0 };
    existing.tokens += tokens;
    existing.cost += cost;
    this.state.byAgent.set(agentId, existing);
  }

  /**
   * Get current cost report
   */
  getReport(): Omit<CostTrackerState, 'byAgent'> & { byAgent: Record<string, AgentUsage> } {
    return {
      sessionId: this.state.sessionId,
      totalTokens: this.state.totalTokens,
      totalCost: this.state.totalCost,
      budget: this.state.budget,
      byAgent: Object.fromEntries(this.state.byAgent),
    };
  }

  /**
   * Get remaining budget
   */
  getRemainingBudget(): number {
    return Math.max(0, this.state.budget - this.state.totalCost);
  }

  /**
   * Get usage by specific agent
   */
  getAgentUsage(agentId: string): AgentUsage | undefined {
    return this.state.byAgent.get(agentId);
  }

  /**
   * Estimate if a call is within budget
   */
  canAfford(estimatedTokens: number, model: string): boolean {
    const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['sonnet']!;
    const avgPrice = (pricing.input + pricing.output) / 2;
    const estimatedCost = (estimatedTokens * avgPrice) / 1000;
    return this.state.totalCost + estimatedCost <= this.state.budget;
  }
}

export { CostTracker, MODEL_PRICING };
export type { AgentUsage, CostTrackerState };
