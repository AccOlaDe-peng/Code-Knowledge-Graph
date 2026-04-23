// TaskTracker — in-memory tasks with batched disk flush

import type { Task } from './types.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * TaskTracker manages task state with batched disk persistence.
 * - In-memory Map for fast reads
 * - Dirty set tracks modified tasks
 * - Batched flush every 5 seconds
 * - forceFlush() on Coordinator completion
 */
class TaskTracker {
  private tasks: Map<string, Task> = new Map();
  private dirty: Set<string> = new Set();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private tasksFile: string;

  constructor(sessionId: string, baseDir?: string) {
    const dir = baseDir ?? path.join(process.env.HOME ?? '/tmp', '.code-graph', 'tasks');
    this.tasksFile = path.join(dir, `${sessionId}.json`);
  }

  /**
   * Start the periodic flush timer
   */
  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), 5000);
  }

  /**
   * Create a new task
   */
  async createTask(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
    this.dirty.add(task.id);
  }

  /**
   * Update a task (in-memory only, flushed periodically)
   */
  async updateTask(taskId: string, update: Partial<Task>): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      Object.assign(task, update);
      this.dirty.add(taskId);
    }
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all pending (non-completed) tasks
   */
  async getPendingTasks(): Promise<Task[]> {
    return [...this.tasks.values()].filter(t => t.status === 'pending');
  }

  /**
   * Get all blocked tasks (pending with blockedBy)
   */
  async getBlockedTasks(): Promise<Task[]> {
    return [...this.tasks.values()].filter(
      t => t.status === 'pending' && t.blockedBy && t.blockedBy.length > 0,
    );
  }

  /**
   * Get all tasks
   */
  getAllTasks(): Task[] {
    return [...this.tasks.values()];
  }

  /**
   * Batched flush dirty tasks to disk
   */
  private async flush(): Promise<void> {
    if (this.dirty.size === 0) return;

    const toFlush = [...this.dirty];
    this.dirty.clear();

    const data: Record<string, Task> = {};
    for (const id of toFlush) {
      const task = this.tasks.get(id);
      if (task) data[id] = task;
    }

    try {
      await fs.mkdir(path.dirname(this.tasksFile), { recursive: true });
      await fs.writeFile(this.tasksFile, JSON.stringify(data, null, 2));
    } catch {
      // Non-blocking: log but don't crash
    }
  }

  /**
   * Force flush all dirty tasks and stop timer (for Coordinator shutdown)
   */
  async forceFlush(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Mark all tasks as dirty for final flush
    for (const id of this.tasks.keys()) {
      this.dirty.add(id);
    }
    await this.flush();
  }

  /**
   * Load tasks from disk (for resuming a session)
   */
  async loadFromDisk(): Promise<void> {
    try {
      const content = await fs.readFile(this.tasksFile, 'utf-8');
      const data = JSON.parse(content) as Record<string, Task>;
      for (const [id, task] of Object.entries(data)) {
        this.tasks.set(id, task);
      }
    } catch {
      // File doesn't exist or is corrupted — start fresh
    }
  }
}

export { TaskTracker };
