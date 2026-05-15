import type { Hono } from 'hono'
import health from './health.js'
import meta from './meta.js'
import { createReposRoutes } from './repos.js'
import { createAnalyzeRoutes } from './analyze.js'
import { createGraphRoutes } from './graph.js'
import { createLineageRoutes } from './lineage.js'
import type { RepoService } from '../services/repo.service.js'
import type { AnalysisService } from '../services/analysis.service.js'
import type { GraphService } from '../services/graph.service.js'
import type { SSEBroadcaster } from '../utils/sse.js'

export function registerRoutes(
  app: Hono,
  services: {
    repoService: RepoService
    analysisService: AnalysisService
    graphService: GraphService
    broadcaster: SSEBroadcaster
  }
) {
  app.route('/health', health)
  app.route('/meta', meta)
  app.route('/repos', createReposRoutes(services.repoService))
  app.route('/analyze', createAnalyzeRoutes(services.analysisService, services.broadcaster))
  app.route('/graph', createGraphRoutes(services.graphService))
  app.get('/services', (c) => {
    const graphId = c.req.query('graph_id') ?? ''
    return c.json(services.graphService.getServicesGraph(graphId))
  })

  app.get('/events', (c) => {
    const graphId = c.req.query('graph_id') ?? ''
    return c.json(services.graphService.getEventsGraph(graphId))
  })
  app.route('/lineage', createLineageRoutes())

  app.get('/api/pipeline/stages', (c) => {
    return c.json({
      stages: [
        { key: 'scanning', label: '文件扫描', description: '扫描代码仓库文件结构' },
        { key: 'static_analysis', label: '静态分析', description: 'AST 解析和静态代码分析' },
        { key: 'semantic_analysis', label: '语义分析', description: 'LLM 驱动的语义理解' },
        { key: 'graph_building', label: '图谱构建', description: '构建知识图谱' },
        { key: 'reporting', label: '报告生成', description: '生成分析报告' },
      ],
      total: 5,
    })
  })
}
