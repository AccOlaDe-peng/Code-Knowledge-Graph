import { Hono } from 'hono'
import type { RepoService } from '../services/repo.service.js'
import type { RepoInfo } from '../types/repo.js'

function repoToWire(repo: RepoInfo) {
  const latest = {
    id: repo.taskId ?? '',
    graph_id: repo.graphId,
    node_count: repo.nodeCount,
    edge_count: repo.edgeCount,
    status: repo.status,
    stage: repo.stage,
    step: repo.step,
    total: repo.total,
    message: repo.message,
    error: repo.error,
    git_commit: repo.gitCommit,
    finished_at: repo.lastAnalyzedAt,
  }

  return {
    id: repo.id,
    name: repo.name,
    path: repo.path,
    branch: repo.branch,
    languages: repo.languages,
    created_at: repo.createdAt,
    updated_at: repo.updatedAt,
    graph_id: repo.graphId,
    node_count: repo.nodeCount,
    edge_count: repo.edgeCount,
    source_mode: repo.sourceMode,
    status: repo.status,
    task_id: repo.taskId,
    stage: repo.stage,
    step: repo.step,
    total: repo.total,
    message: repo.message,
    error: repo.error,
    git_commit: repo.gitCommit,
    latest_analysis: latest,
  }
}

export function createReposRoutes(repoService: RepoService) {
  const router = new Hono()

  router.get('/', (c) => {
    const repos = repoService.listRepos()
    return c.json({ repos: repos.map(repoToWire) })
  })

  router.post('/', async (c) => {
    const body = await c.req.json()
    if (!body.repo_name && !body.name) {
      return c.json({ error: 'bad_request', message: 'repo_name is required', status: 400 }, 400)
    }
    const repo = repoService.createRepo({
      name: body.repo_name ?? body.name,
      path: body.repo_path ?? body.path,
      branch: body.branch,
      sourceMode: body.source_mode,
      languages: body.language ?? body.languages,
    })
    return c.json(repoToWire(repo))
  })

  router.post('/save', async (c) => {
    const body = await c.req.json()
    if (!body.repo_id || !body.repo_name || !body.repo_path) {
      return c.json({ error: 'bad_request', message: 'repo_id, repo_name, and repo_path are required', status: 400 }, 400)
    }
    const repo = repoService.saveRepo({
      id: body.repo_id,
      name: body.repo_name,
      path: body.repo_path,
      branch: body.branch,
      sourceMode: body.source_mode,
      languages: body.language,
    })
    return c.json({ repo_id: repo.id, status: repo.status })
  })

  router.delete('/:id', (c) => {
    repoService.deleteRepo(c.req.param('id'))
    return c.json({ ok: true })
  })

  router.get('/:id/analyses', (c) => {
    return c.json({ analyses: [] })
  })

  return router
}

export { repoToWire }
