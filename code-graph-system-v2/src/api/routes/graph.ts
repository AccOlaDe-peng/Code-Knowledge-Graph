import { Router, Request, Response } from 'express';
import { JSONStorage } from '../../storage/json-storage';
import { GraphLoader } from '../../storage/graph-loader';

const router = Router();
const storage = new JSONStorage();
const loader = new GraphLoader(storage);

/**
 * GET /api/graph
 * List all graphs or get a specific graph
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { graphId } = req.query;

    if (graphId) {
      // Get specific graph
      const graph = await loader.loadById(graphId as string);
      res.json(graph);
    } else {
      // List all graphs
      const graphs = await storage.listGraphs();
      res.json(graphs);
    }
  } catch (error) {
    res.status(404).json({
      error: 'Not Found',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/graph/:repoId
 * Get all graphs for a repository
 */
router.get('/:repoId', async (req: Request, res: Response) => {
  try {
    const { repoId } = req.params;
    const { graphType } = req.query;

    if (graphType) {
      // Get specific graph type
      const graph = await storage.loadGraph(repoId, graphType as string);
      res.json(graph);
    } else {
      // Get all graphs for this repo
      const allGraphs = await storage.listGraphs();
      const repoGraphs = allGraphs.filter(g => g.graphId.startsWith(`${repoId}/`));
      res.json(repoGraphs);
    }
  } catch (error) {
    res.status(404).json({
      error: 'Not Found',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/graph/:repoId/module
 * Get module dependency graph
 */
router.get('/:repoId/module', async (req: Request, res: Response) => {
  try {
    const { repoId } = req.params;
    const graph = await storage.loadGraph(repoId, 'module-graph');
    res.json(graph);
  } catch (error) {
    res.status(404).json({
      error: 'Not Found',
      message: 'Module graph not found',
    });
  }
});

/**
 * GET /api/graph/:repoId/call
 * Get function call graph
 */
router.get('/:repoId/call', async (req: Request, res: Response) => {
  try {
    const { repoId } = req.params;
    const graph = await storage.loadGraph(repoId, 'call-graph');
    res.json(graph);
  } catch (error) {
    res.status(404).json({
      error: 'Not Found',
      message: 'Call graph not found',
    });
  }
});

/**
 * GET /api/graph/:repoId/lineage
 * Get data lineage graph
 */
router.get('/:repoId/lineage', async (req: Request, res: Response) => {
  try {
    const { repoId } = req.params;
    const graph = await storage.loadGraph(repoId, 'data-lineage');
    res.json(graph);
  } catch (error) {
    res.status(404).json({
      error: 'Not Found',
      message: 'Data lineage graph not found',
    });
  }
});

/**
 * GET /api/graph/:repoId/subgraph
 * Get subgraph around specific nodes
 */
router.get('/:repoId/subgraph', async (req: Request, res: Response) => {
  try {
    const { repoId } = req.params;
    const { nodeIds, depth = '1', graphType = 'graph' } = req.query;

    if (!nodeIds) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'nodeIds parameter is required',
      });
    }

    const nodeIdArray = (nodeIds as string).split(',');
    const depthNum = parseInt(depth as string);

    const subgraph = await storage.getSubGraph(
      repoId,
      graphType as string,
      nodeIdArray,
      depthNum
    );

    res.json(subgraph);
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/graph/:repoId/stats
 * Get graph statistics
 */
router.get('/:repoId/stats', async (req: Request, res: Response) => {
  try {
    const { repoId } = req.params;
    const { graphType = 'graph' } = req.query;

    const graphId = `${repoId}/${graphType}`;
    const stats = await loader.getStatistics(graphId);

    res.json(stats);
  } catch (error) {
    res.status(404).json({
      error: 'Not Found',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/graph/:repoId
 * Delete a graph or entire repository
 */
router.delete('/:repoId', async (req: Request, res: Response) => {
  try {
    const { repoId } = req.params;
    const { graphType } = req.query;

    await storage.deleteGraph(repoId, graphType as string | undefined);

    res.json({
      success: true,
      message: `Deleted ${graphType ? 'graph' : 'repository'}: ${repoId}${graphType ? '/' + graphType : ''}`,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export { router as graphRoutes };
