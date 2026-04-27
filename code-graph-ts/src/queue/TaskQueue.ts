// TaskQueue — Simple in-memory async task queue (Phase 2)
// Can be replaced with BullMQ + Redis for production

import type { Task } from '../coordinator/types.ts';
import { Confidence } from '../graph/schema.ts';
import * as crypto from 'node:crypto';

const uuidv4 = () => crypto.randomUUID();

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

interface QueueTask extends Task {
  id: string;
  status: TaskStatus;
  progress: number;
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

interface TaskHandler {
  (task: QueueTask, updateProgress: (progress: number) => void): Promise<unknown>;
}

interface SSENotifier {
  (sessionId: string, event: string, data: unknown): void;
}

class TaskQueue {
  private tasks: Map<string, QueueTask> = new Map();
  private handlers: Map<string, TaskHandler> = new Map();
  private sseNotifier?: SSENotifier;
  private concurrency: number;
  private running: number = 0;
  private queue: QueueTask[] = [];

  constructor(options?: { concurrency?: number }) {
    this.concurrency = options?.concurrency ?? 4;
  }

  setSSENotifier(notifier: SSENotifier): void {
    this.sseNotifier = notifier;
  }

  registerHandler(taskType: string, handler: TaskHandler): void {
    this.handlers.set(taskType, handler);
  }

  async enqueue(
    taskType: string,
    payload: Record<string, unknown>,
    options?: { sessionId?: string }
  ): Promise<string> {
    const taskId = uuidv4();
    const sessionId = options?.sessionId ?? `session-${Date.now()}`;

    const task: QueueTask = {
      id: taskId,
      status: 'pending',
      progress: 0,
      sessionId,
      blockedBy: [],
      ...payload,
    };

    this.tasks.set(taskId, task);

    // Add to queue and try to process
    this.queue.push(task);
    this.processQueue();

    return taskId;
  }

  async getStatus(taskId: string): Promise<QueueTask | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async getTaskBySession(sessionId: string): Promise<QueueTask | null> {
    for (const task of this.tasks.values()) {
      if (task.sessionId === sessionId) {
        return task;
      }
    }
    return null;
  }

  async cancel(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'pending') {
      task.status = 'failed';
      task.error = 'Cancelled';
      return true;
    }

    return false;
  }

  private processQueue(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task || task.status !== 'pending') continue;

      this.running++;
      this.executeTask(task);
    }
  }

  private async executeTask(task: QueueTask): Promise<void> {
    const handler = this.handlers.get('analyze');
    if (!handler) {
      task.status = 'failed';
      task.error = 'No handler registered';
      this.running--;
      this.processQueue();
      return;
    }

    task.status = 'running';
    task.startedAt = new Date().toISOString();

    const updateProgress = (progress: number): void => {
      task.progress = Math.min(100, Math.max(0, progress));
      this.sseNotifier?.(task.sessionId, 'progress', {
        taskId: task.id,
        progress: task.progress,
        status: task.status,
      });
    };

    try {
      const result = await handler(task, updateProgress);
      task.result = result;
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.progress = 100;

      this.sseNotifier?.(task.sessionId, 'complete', {
        taskId: task.id,
        result,
      });
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);

      this.sseNotifier?.(task.sessionId, 'error', {
        taskId: task.id,
        error: task.error,
      });
    } finally {
      this.running--;
      this.processQueue();
    }
  }

  getStats(): { pending: number; running: number; completed: number; failed: number } {
    let pending = 0, running = 0, completed = 0, failed = 0;

    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'pending': pending++; break;
        case 'running': running++; break;
        case 'completed': completed++; break;
        case 'failed': failed++; break;
      }
    }

    return { pending, running, completed, failed };
  }
}

export { TaskQueue };
export type { QueueTask, TaskStatus, TaskHandler, SSENotifier };
