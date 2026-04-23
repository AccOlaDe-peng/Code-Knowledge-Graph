// ScannerAgent — repository scanning and git incremental detection

import { BaseAgent } from '../BaseAgent.ts';
import { createFileScanTool, createGitDiffTool, type ScanResult } from '../tools/FileScanTool.ts';
import { createCacheCheckTool } from '../tools/CacheTool.ts';
import type { AgentConfig, AgentResult, Task } from '../../coordinator/types.ts';
import type { AgentContext } from '../AgentContext.ts';
import { CacheManager } from '../../cache/CacheManager.ts';
import { Confidence } from '../../graph/schema.ts';

const SCANNER_CONFIG: AgentConfig = {
  name: 'ScannerAgent',
  description: 'Scans repository files, detects languages, checks git diff for incremental updates',
  tools: ['FileScanTool', 'GitDiffTool', 'CacheCheckTool'],
  model: 'haiku',
};

class ScannerAgent extends BaseAgent {
  private scanResult: ScanResult | null = null;

  constructor(id: string, context: AgentContext, cacheManager: CacheManager) {
    super(id, SCANNER_CONFIG, context, [
      createFileScanTool(),
      createGitDiffTool(),
      createCacheCheckTool(cacheManager),
    ]);
  }

  async execute(task: Task): Promise<AgentResult> {
    await this.onTaskStart(task);

    try {
      // Scan the repository
      const result = await this.useTool('FileScanTool', this.context.workingDirectory) as ScanResult;
      this.scanResult = result;

      // Check git diff for incremental detection
      let changedFiles: string[] = [];
      try {
        changedFiles = await this.useTool('GitDiffTool', this.context.workingDirectory) as string[];
      } catch {
        // Not a git repo or git not available — full scan
      }

      // Check cache for existing results
      const cacheCheck = this.context.cache.check(
        result.files.map(f => f.path),
      );

      const processedFiles = changedFiles.length > 0
        ? changedFiles
        : result.files.map(f => f.path);

      const agentResult = this.createResult([], [], {
        confidence: Confidence.EXTRACTED,
        source: 'ast',
        filesProcessed: processedFiles,
      });

      // Store scan metadata in a module-level variable for other agents
      // ScannerAgent output is metadata-only (no graph nodes)
      await this.onTaskComplete(agentResult);
      return agentResult;
    } catch (error) {
      await this.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  // Expose scan result for Coordinator
  getScanResult(): ScanResult | null {
    return this.scanResult;
  }

  onTaskStart(_task: Task): Promise<void> { return Promise.resolve(); }
  onTaskComplete(_result: AgentResult): Promise<void> { return Promise.resolve(); }
  onError(_error: Error): Promise<void> { return Promise.resolve(); }
}

export { ScannerAgent, SCANNER_CONFIG };
