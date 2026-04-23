// CacheTool — cache check/store operations for agents

import { createTool } from './common.ts';
import type { Tool } from '../BaseAgent.ts';
import type { CacheManager, CacheType } from '../../cache/CacheManager.ts';

// Tool for checking cache hits
function createCacheCheckTool(cacheManager: CacheManager): Tool {
  return createTool<string[], { hit: string[]; miss: string[] }>(
    'CacheCheckTool',
    async (filePaths: string[]) => {
      const result = cacheManager.check(filePaths);
      return { success: true, data: result };
    },
  );
}

// Tool for getting cached result
function createCacheGetTool(cacheManager: CacheManager): Tool {
  return createTool<string, unknown>('CacheGetTool', async (key: string) => {
    const entry = cacheManager.get(key);
    if (!entry) {
      return { success: true, data: null };
    }
    return { success: true, data: entry.result };
  });
}

// Tool for storing cache result
function createCacheSetTool(cacheManager: CacheManager): Tool {
  return createTool<{ key: string; result: unknown; type: CacheType }, void>(
    'CacheSetTool',
    async ({ key, result, type }) => {
      cacheManager.set(key, result, type);
      return { success: true, data: undefined };
    },
  );
}

export { createCacheCheckTool, createCacheGetTool, createCacheSetTool };
