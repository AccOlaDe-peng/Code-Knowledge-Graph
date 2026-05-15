import { describe, it, expect } from 'vitest'
import app from '../src/app.js'

describe('端到端流程', () => {
  it('完整仓库管理流程', async () => {
    // 1. 创建仓库
    const createRes = await app.request('/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_name: 'e2e-repo', repo_path: '/tmp/e2e' }),
    })
    expect(createRes.status).toBe(200)
    const repo = await createRes.json()
    const repoId = repo.id

    // 2. 列出仓库
    const listRes = await app.request('/repos')
    const listBody = await listRes.json()
    expect(listBody.repos.length).toBeGreaterThanOrEqual(1)

    // 3. 获取元数据
    const metaRes = await app.request('/meta/node-types')
    expect(metaRes.status).toBe(200)
    const meta = await metaRes.json()
    expect(meta.architecture_types.length).toBeGreaterThan(0)

    // 4. 提交分析
    const analyzeRes = await app.request('/analyze/repository', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_path: '/tmp/e2e', repo_id: repoId, repo_name: 'e2e-repo' }),
    })
    expect(analyzeRes.status).toBe(200)
    const task = await analyzeRes.json()
    expect(task.task_id).toBeTruthy()

    // 5. 查询分析状态
    const statusRes = await app.request(`/analyze/status/${task.task_id}`)
    expect(statusRes.status).toBe(200)

    // 6. 获取图数据（空图）
    const graphRes = await app.request(`/graph/framework?repo_id=${repoId}`)
    expect(graphRes.status).toBe(200)
    const graph = await graphRes.json()
    expect(graph.repo_id).toBe(repoId)

    // 7. Pipeline stages
    const stagesRes = await app.request('/api/pipeline/stages')
    expect(stagesRes.status).toBe(200)
    const stages = await stagesRes.json()
    expect(stages.total).toBe(5)

    // 8. 删除仓库
    const delRes = await app.request(`/repos/${repoId}`, { method: 'DELETE' })
    expect(delRes.status).toBe(200)
  })

  it('health 端点正常', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  it('lineage mock 端点正常', async () => {
    const impactRes = await app.request('/lineage/impact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_id: 'test', node_id: 'n1', change_type: 'modify' }),
    })
    expect(impactRes.status).toBe(200)
    const impact = await impactRes.json()
    expect(impact.risk_level).toBe('low')

    const traceRes = await app.request('/lineage/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_id: 'test', node_id: 'n1', trace_type: 'full' }),
    })
    expect(traceRes.status).toBe(200)
  })

  it('services 和 events 端点正常', async () => {
    const servicesRes = await app.request('/services?graph_id=test')
    expect(servicesRes.status).toBe(200)

    const eventsRes = await app.request('/events?graph_id=test')
    expect(eventsRes.status).toBe(200)
  })
})
