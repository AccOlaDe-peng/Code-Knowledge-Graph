// Agent Context — read-only configuration, no shared writes

import type { Task } from '../coordinator/types.ts';

// Cache manager interface (implemented separately)
interface CacheManager {
  check(filePaths: string[]): { hit: string[]; miss: string[] };
  get(key: string): { result: unknown } | null;
}

// Task tracker interface (implemented separately)
interface TaskTracker {
  getPendingTasks(): Promise<Task[]>;
  getBlockedTasks(): Promise<Task[]>;
}

// Agent context is read-only to prevent concurrency issues
// Agents return independent results, Coordinator merges them
interface AgentContext {
  sessionId: string;
  workingDirectory: string;
  cache: CacheManager;
  taskTracker: TaskTracker;
}

// Factory for creating contexts
function createAgentContext(
  sessionId: string,
  workingDirectory: string,
  cache: CacheManager,
  taskTracker: TaskTracker,
): AgentContext {
  return {
    sessionId,
    workingDirectory,
    cache,
    taskTracker,
  };
}

export type { AgentContext, CacheManager, TaskTracker };
export { createAgentContext };
