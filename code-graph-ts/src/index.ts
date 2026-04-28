// Code Knowledge Graph — Agent Pipeline Entry Point

export { Coordinator } from './coordinator/Coordinator.ts';
export type { AnalyzeRequest, AnalysisMode, AnalysisDecision } from './coordinator/types.ts';

export type { GraphNode, GraphEdge, GraphData } from './graph/schema.ts';
export { NodeType, EdgeType, Confidence, validateGraph } from './graph/schema.ts';

export { BaseAgent } from './agents/BaseAgent.ts';
export { AgentPool } from './agents/AgentPool.ts';
export { AgentRunner } from './agents/AgentRunner.ts';

export { ScannerAgent, SCANNER_CONFIG } from './agents/specialized/ScannerAgent.ts';
export { StaticAgent, STATIC_CONFIG } from './agents/specialized/StaticAgent.ts';
export { SemanticAgent, SEMANTIC_CONFIG } from './agents/specialized/SemanticAgent.ts';
export { LineageAgent, LINEAGE_CONFIG } from './agents/specialized/LineageAgent.ts';
export { GraphBuildAgent, GRAPH_BUILD_CONFIG } from './agents/specialized/GraphBuildAgent.ts';
export { ReportAgent, REPORT_CONFIG } from './agents/specialized/ReportAgent.ts';

export { CacheManager } from './cache/CacheManager.ts';
export { CostTracker } from './cost/CostTracker.ts';
export { Merger } from './coordinator/Merger.ts';
export { TaskTracker } from './coordinator/TaskTracker.ts';
export { CheckpointManager } from './errors/CheckpointManager.ts';
export { AgentError } from './errors/index.ts';

export { createServer, startServer } from './api/server.ts';

import { startServer } from './api/server.ts';

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Default: start API server
  if (!command || command === 'serve') {
    const port = parseInt(process.env.PORT ?? '8848', 10);
    const host = process.env.HOST ?? '0.0.0.0';
    await startServer(port, host);
    return;
  }

  // Analyze command
  if (command === 'analyze') {
    const repoPath = args[1];

    if (!repoPath) {
      console.log(`
Usage:
  bun run src/index.ts serve              Start API server (default)
  bun run src/index.ts analyze <path>     Run analysis CLI
  bun run src/index.ts --help             Show this help
`);
      process.exit(0);
    }

    console.log(`Analyzing: ${repoPath}`);

    const { Coordinator } = await import('./coordinator/Coordinator.ts');
    const coordinator = new Coordinator('cli-session');

    try {
      const result = await coordinator.analyze({
        path: repoPath,
        enableLineage: args.includes('--enable-lineage'),
        budget: args.find(a => a === '--budget') ? parseInt(args[args.indexOf('--budget') + 1] ?? '100000', 10) : undefined,
      });

      console.log('\n=== Analysis Complete ===');
      console.log(`Nodes: ${result.nodes.length}`);
      console.log(`Edges: ${result.edges.length}`);
    } catch (error) {
      console.error('Analysis failed:', error);
      process.exit(1);
    }
    return;
  }

  // Help
  if (command === '--help' || command === '-h') {
    console.log(`
Code Knowledge Graph — Agent Pipeline

Commands:
  serve              Start API server (default)
  analyze <path>     Run analysis CLI

API Server Options:
  PORT=3000          Server port
  HOST=0.0.0.0       Server host

Analyze Options:
  --enable-lineage   Enable lineage inference
  --budget <tokens>  Token budget limit

Examples:
  bun run src/index.ts
  bun run src/index.ts analyze /path/to/repo
  PORT=8080 bun run src/index.ts serve
`);
    process.exit(0);
  }
}

// Run CLI if executed directly
if (import.meta.main) {
  main();
}
