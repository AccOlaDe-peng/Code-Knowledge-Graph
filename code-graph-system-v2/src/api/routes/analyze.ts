import { Router, Request, Response } from 'express';
import { scanRepository } from '../../scanner';
import { chunkFiles } from '../../chunker';
import { createAIClient } from '../../parser';
import { GraphMerger } from '../../builder';
import { JSONStorage } from '../../storage/json-storage';
import { Graph, NodeType, EdgeType } from '../../types/graph';

const router = Router();
const storage = new JSONStorage();

// In-memory job tracking (in production, use Redis or database)
const jobs = new Map<string, {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  result?: any;
  error?: string;
  createdAt: string;
}>();

/**
 * POST /api/analyze
 * Trigger repository analysis
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { repoPath, repoName, enableAI = false } = req.body;

    if (!repoPath) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'repoPath is required',
      });
    }

    // Create job
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    jobs.set(jobId, {
      id: jobId,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
    });

    // Start analysis in background
    analyzeRepository(jobId, repoPath, repoName, enableAI).catch(error => {
      const job = jobs.get(jobId);
      if (job) {
        job.status = 'failed';
        job.error = error.message;
      }
    });

    res.json({
      jobId,
      status: 'pending',
      message: 'Analysis started',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/analyze/:jobId
 * Get analysis job status
 */
router.get('/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Job not found',
    });
  }

  res.json(job);
});

/**
 * Background analysis function
 */
async function analyzeRepository(
  jobId: string,
  repoPath: string,
  repoName?: string,
  enableAI: boolean = false
): Promise<void> {
  const job = jobs.get(jobId)!;
  job.status = 'running';

  try {
    // Step 1: Scan repository
    console.log(`[${jobId}] Scanning repository: ${repoPath}`);
    job.progress = 10;
    const scanResult = await scanRepository(repoPath);

    const finalRepoName = repoName || scanResult.repoInfo.name;
    const repoId = finalRepoName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // Step 2: Chunk files
    console.log(`[${jobId}] Chunking ${scanResult.files.length} files`);
    job.progress = 30;
    const chunks = await chunkFiles(
      scanResult.files.map(f => ({ path: f.path, language: f.language }))
    );

    // Step 3: Build graph
    console.log(`[${jobId}] Building graph from ${chunks.length} chunks`);
    job.progress = 50;

    const merger = new GraphMerger();

    if (enableAI) {
      // Use AI to analyze code
      const aiClient = createAIClient();

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`[${jobId}] Analyzing chunk ${i + 1}/${chunks.length}: ${chunk.path}`);

        try {
          const graphResponse = await aiClient.analyzeCode(
            chunk.language,
            chunk.path,
            chunk.code
          );

          merger.addNodes(graphResponse.nodes);
          merger.addEdges(graphResponse.edges);
        } catch (error) {
          console.error(`Failed to analyze ${chunk.path}:`, error);
        }

        job.progress = 50 + Math.floor((i / chunks.length) * 40);
      }
    } else {
      // Simple static analysis (create basic file/module nodes)
      for (const chunk of chunks) {
        merger.addNodes([
          {
            id: `file:${chunk.path}`,
            type: NodeType.File,
            name: chunk.path.split('/').pop() || chunk.path,
            properties: {
              path: chunk.path,
              language: chunk.language,
              lines: chunk.endLine - chunk.startLine + 1,
            },
          },
        ]);
      }
      job.progress = 90;
    }

    // Step 4: Create graph object
    const nodes = merger.getNodes();
    const edges = merger.getEdges();

    const nodeTypeDistribution: Record<string, number> = {};
    for (const node of nodes) {
      nodeTypeDistribution[node.type] = (nodeTypeDistribution[node.type] || 0) + 1;
    }

    const edgeTypeDistribution: Record<string, number> = {};
    for (const edge of edges) {
      edgeTypeDistribution[edge.type] = (edgeTypeDistribution[edge.type] || 0) + 1;
    }

    const graph: Graph = {
      graph_version: '2.0.0',
      repo: {
        name: finalRepoName,
        path: repoPath,
        language: Array.from(new Set(scanResult.files.map(f => f.language))),
        totalFiles: scanResult.files.length,
        totalSize: scanResult.repoInfo.totalSize,
      },
      nodes,
      edges,
      metadata: {
        createdAt: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length,
        nodeTypeDistribution: nodeTypeDistribution as any,
        edgeTypeDistribution: edgeTypeDistribution as any,
      },
    };

    // Step 5: Save graph
    console.log(`[${jobId}] Saving graph`);
    const graphId = await storage.saveGraph(repoId, 'graph', graph);

    job.status = 'completed';
    job.progress = 100;
    job.result = {
      graphId,
      repoId,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      fileCount: scanResult.files.length,
    };

    console.log(`[${jobId}] Analysis completed: ${graphId}`);
  } catch (error) {
    console.error(`[${jobId}] Analysis failed:`, error);
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    throw error;
  }
}

export { router as analyzeRoutes };
