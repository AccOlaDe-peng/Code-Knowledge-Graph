// CheckpointManager — chunk-level checkpoint for resume

import type { AgentResult } from '../coordinator/types.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Item status within a phase
type ItemStatus = 'pending' | 'completed' | 'failed';

// Phase state with chunk-level tracking
interface PhaseState {
  status: 'pending' | 'running' | 'completed';
  items: Record<string, {
    status: ItemStatus;
    result?: AgentResult;
  }>;
}

// Chunk-level checkpoint (not phase-level)
interface Checkpoint {
  sessionId: string;
  phases: Record<string, PhaseState>;
  createdAt: number;
}

/**
 * CheckpointManager enables resume at chunk granularity.
 * - Each phase tracks individual items (chunks)
 * - Resume only retries failed/pending items
 * - Prevents losing completed chunk results on crash
 */
class CheckpointManager {
  private checkpointFile: string;
  private checkpoint: Checkpoint | null = null;

  constructor(sessionId: string, baseDir?: string) {
    const dir = baseDir ?? path.join(process.env.HOME ?? '/tmp', '.code-graph', 'checkpoints');
    this.checkpointFile = path.join(dir, `${sessionId}.json`);
  }

  /**
   * Initialize or load checkpoint
   */
  async initialize(phases: string[]): Promise<void> {
    await this.load();

    if (!this.checkpoint) {
      this.checkpoint = {
        sessionId: path.basename(this.checkpointFile, '.json'),
        phases: {},
        createdAt: Date.now(),
      };

      for (const phase of phases) {
        this.checkpoint.phases[phase] = {
          status: 'pending',
          items: {},
        };
      }
    }
  }

  /**
   * Load checkpoint from disk
   */
  async load(): Promise<Checkpoint | null> {
    try {
      const content = await fs.readFile(this.checkpointFile, 'utf-8');
      this.checkpoint = JSON.parse(content) as Checkpoint;
      return this.checkpoint;
    } catch {
      this.checkpoint = null;
      return null;
    }
  }

  /**
   * Save checkpoint to disk
   */
  async save(): Promise<void> {
    if (!this.checkpoint) return;

    await fs.mkdir(path.dirname(this.checkpointFile), { recursive: true });
    await fs.writeFile(this.checkpointFile, JSON.stringify(this.checkpoint, null, 2));
  }

  /**
   * Start a phase (mark as running)
   */
  startPhase(phase: string): void {
    if (!this.checkpoint) return;
    if (!this.checkpoint.phases[phase]) {
      this.checkpoint.phases[phase] = { status: 'running', items: {} };
    }
    this.checkpoint.phases[phase].status = 'running';
  }

  /**
   * Mark an item within a phase as completed
   */
  completeItem(phase: string, itemId: string, result: AgentResult): void {
    if (!this.checkpoint) return;
    if (!this.checkpoint.phases[phase]) return;

    this.checkpoint.phases[phase].items[itemId] = {
      status: 'completed',
      result,
    };
  }

  /**
   * Mark an item within a phase as failed
   */
  failItem(phase: string, itemId: string): void {
    if (!this.checkpoint) return;
    if (!this.checkpoint.phases[phase]) return;

    this.checkpoint.phases[phase].items[itemId] = {
      status: 'failed',
    };
  }

  /**
   * Complete a phase (all items done)
   */
  completePhase(phase: string): void {
    if (!this.checkpoint) return;
    if (!this.checkpoint.phases[phase]) return;
    this.checkpoint.phases[phase].status = 'completed';
  }

  /**
   * Get pending/failed items for a phase (for resume)
   */
  getRetryItems(phase: string): string[] {
    if (!this.checkpoint) return [];
    if (!this.checkpoint.phases[phase]) return [];

    const items = this.checkpoint.phases[phase].items;
    return Object.entries(items)
      .filter(([_, item]) => item.status === 'pending' || item.status === 'failed')
      .map(([id, _]) => id);
  }

  /**
   * Get completed results for a phase
   */
  getCompletedResults(phase: string): AgentResult[] {
    if (!this.checkpoint) return [];
    if (!this.checkpoint.phases[phase]) return [];

    const items = this.checkpoint.phases[phase].items;
    return Object.values(items)
      .filter(item => item.status === 'completed' && item.result)
      .map(item => item.result!);
  }

  /**
   * Check if phase is completed
   */
  isPhaseCompleted(phase: string): boolean {
    if (!this.checkpoint) return false;
    return this.checkpoint.phases[phase]?.status === 'completed';
  }

  /**
   * Delete checkpoint file
   */
  async delete(): Promise<void> {
    try {
      await fs.unlink(this.checkpointFile);
    } catch {
      // Ignore if doesn't exist
    }
    this.checkpoint = null;
  }
}

export type { Checkpoint, PhaseState, ItemStatus };
export { CheckpointManager };
