import { Hono } from 'hono'
import type { GraphService } from '../services/graph.service.js'
import type { GraphNode, GraphEdge } from '../types/graph.js'

function nodeToRaw(node: GraphNode) {
  return {
    id: node.id,
    type: node.type,
    name: node.label,
    properties: node.metadata ?? {},
  }
}

function edgeToRaw(edge: GraphEdge) {
  return {
    from: edge.source,
    to: edge.target,
    type: edge.type,
    properties: edge.metadata ?? {},
  }
}

export function createGraphRoutes(graphService: GraphService) {
  const router = new Hono()

  router.get('/framework', (c) => {
    const repoId = c.req.query('repo_id') ?? ''
    const nodeTypes = c.req.query('node_types')
    const types = nodeTypes ? nodeTypes.split(',') : undefined
    const { nodes, edges } = graphService.getFramework(repoId, types)
    return c.json({
      repo_id: repoId,
      node_count: nodes.length,
      edge_count: edges.length,
      nodes: nodes.map(nodeToRaw),
      edges: edges.map(edgeToRaw),
    })
  })

  router.get('/lineage', (c) => {
    const repoId = c.req.query('repo_id') ?? ''
    const graph = graphService.getLineage(repoId, {
      edgeTypes: c.req.query('edge_types')?.split(','),
      nodeId: c.req.query('node_id'),
      depth: c.req.query('depth') ? Number(c.req.query('depth')) : undefined,
      direction: c.req.query('direction'),
      moduleId: c.req.query('module_id'),
      includeCalls: c.req.query('include_calls') === 'true',
    })
    return c.json({
      repo_id: repoId,
      edge_types: [],
      node_count: graph.nodes.length,
      edge_count: graph.edges.length,
      nodes: graph.nodes.map(nodeToRaw),
      edges: graph.edges.map(edgeToRaw),
    })
  })

  router.get('/lineage/modules', (c) => {
    const repoId = c.req.query('repo_id') ?? ''
    const result = graphService.getLineageModules(repoId)
    return c.json({
      repo_id: repoId,
      module_count: result.moduleCount,
      edge_count: result.edgeCount,
      modules: result.modules,
      edges: result.edges,
    })
  })

  router.get('/function-call', (c) => {
    const repoId = c.req.query('repo_id') ?? ''
    return c.json(graphService.getFunctionCallGraph(repoId))
  })

  router.get('/architecture/:repoId', (c) => {
    const repoId = c.req.param('repoId')
    return c.json(graphService.getArchitecture(repoId))
  })

  return router
}

export function createServicesRoutes(graphService: GraphService) {
  const router = new Hono()

  router.get('/services', (c) => {
    const graphId = c.req.query('graph_id') ?? ''
    return c.json(graphService.getServicesGraph(graphId))
  })

  router.get('/events', (c) => {
    const graphId = c.req.query('graph_id') ?? ''
    return c.json(graphService.getEventsGraph(graphId))
  })

  return router
}
