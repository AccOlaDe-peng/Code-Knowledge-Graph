import { Hono } from 'hono'

export function createLineageRoutes() {
  const router = new Hono()

  router.post('/impact', async (c) => {
    const body = await c.req.json()
    if (!body.repo_id || !body.node_id || !body.change_type) {
      return c.json({ error: 'bad_request', message: 'repo_id, node_id, and change_type are required', status: 400 }, 400)
    }
    return c.json({
      repo_id: body.repo_id,
      changed_node_id: body.node_id,
      change_type: body.change_type,
      risk_level: 'low',
      impact_summary: {
        total_affected: 0,
        services: 0,
        api_endpoints: 0,
        databases: 0,
        topics: 0,
        change_type: body.change_type,
      },
      affected_nodes: [],
      affected_edges: [],
      affected_apis: [],
      affected_databases: [],
      recommendations: [],
    })
  })

  router.post('/trace', async (c) => {
    const body = await c.req.json()
    if (!body.repo_id || !body.node_id || !body.trace_type) {
      return c.json({ error: 'bad_request', message: 'repo_id, node_id, and trace_type are required', status: 400 }, 400)
    }
    return c.json({
      repo_id: body.repo_id,
      target_node_id: body.node_id,
      trace_type: body.trace_type,
      source_nodes: [],
      transformation_chain: [],
      upstream_nodes: [],
      upstream_edges: [],
      confidence: 0,
    })
  })

  return router
}
