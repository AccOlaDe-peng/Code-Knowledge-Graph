import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AnalysisService } from '../services/analysis.service.js'
import type { SSEBroadcaster } from '../utils/sse.js'

export function createAnalyzeRoutes(analysisService: AnalysisService, broadcaster: SSEBroadcaster) {
  const router = new Hono()

  router.post('/repository', async (c) => {
    const body = await c.req.json()
    if (!body.repo_path) {
      return c.json({ error: 'bad_request', message: 'repo_path is required', status: 400 }, 400)
    }
    const task = analysisService.submitAnalysis(
      body.repo_id ?? 'unknown',
      body.repo_name ?? 'unknown',
      body.repo_path,
      body.branch,
    )
    return c.json({ task_id: task.id, status: task.status })
  })

  router.get('/status/:taskId', (c) => {
    const task = analysisService.getStatus(c.req.param('taskId'))
    if (!task) {
      return c.json({ error: 'not_found', message: 'Task not found', status: 404 }, 404)
    }
    return c.json({
      task_id: task.id,
      status: task.status,
      step: task.step,
      total: task.total,
      stage: task.stage,
      message: task.message,
      log: task.log,
      elapsed_seconds: task.elapsedSeconds,
      graph_id: task.graphId,
      node_count: task.nodeCount,
      edge_count: task.edgeCount,
      error: task.error,
    })
  })

  router.get('/stream/:taskId', (c) => {
    const taskId = c.req.param('taskId')
    return streamSSE(c, async (stream) => {
      const unsubscribe = broadcaster.subscribe(taskId, (event, data) => {
        stream.writeSSE({ event, data: JSON.stringify(data) })
      })

      const task = analysisService.getStatus(taskId)
      if (task && (task.status === 'completed' || task.status === 'failed' || task.status === 'canceled')) {
        stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            status: task.status,
            graph_id: task.graphId,
            node_count: task.nodeCount,
            edge_count: task.edgeCount,
            error: task.error,
          }),
        })
        unsubscribe()
        return
      }

      stream.onAbort(() => {
        unsubscribe()
      })

      await new Promise(() => {})
    })
  })

  router.post('/cancel/:taskId', (c) => {
    const taskId = c.req.param('taskId')
    const task = analysisService.cancelAnalysis(taskId)
    if (!task) {
      return c.json({ error: 'not_found', message: 'Task not found', status: 404 }, 404)
    }
    return c.json({ task_id: task.id, status: task.status, message: 'Analysis canceled' })
  })

  return router
}
