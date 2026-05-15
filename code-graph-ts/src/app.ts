import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { registerRoutes } from './routes/index.js'
import { RepoStore } from './stores/repo-store.js'
import { AnalysisStore } from './stores/analysis-store.js'
import { GraphStore } from './stores/graph-store.js'
import { RepoService } from './services/repo.service.js'
import { AnalysisService } from './services/analysis.service.js'
import { GraphService } from './services/graph.service.js'
import { createSSEBroadcaster } from './utils/sse.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ErrorResponse } from './types/api.js'

const DATA_DIR = process.env.DATA_DIR ?? join(homedir(), '.code-graph')

const repoStore = new RepoStore(DATA_DIR)
const analysisStore = new AnalysisStore()
const graphStore = new GraphStore(DATA_DIR)

const repoService = new RepoService(repoStore)
const analysisService = new AnalysisService(analysisStore)
const graphService = new GraphService(graphStore)

const broadcaster = createSSEBroadcaster()
analysisService.setBroadcaster(broadcaster)

const app = new Hono()

app.use('*', cors())
app.use('*', logger())

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  const response: ErrorResponse = {
    error: 'internal_error',
    message: err.message ?? 'Internal server error',
    status: 500,
  }
  return c.json(response, 500)
})

registerRoutes(app, { repoService, analysisService, graphService, broadcaster })

export default app
