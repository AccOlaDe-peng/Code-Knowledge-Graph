import { describe, it, expect, beforeEach } from 'vitest'
import { AnalysisStore } from '../src/stores/analysis-store.js'

describe('AnalysisStore', () => {
  let store: AnalysisStore

  beforeEach(() => {
    store = new AnalysisStore()
  })

  it('创建任务', () => {
    const task = store.create('repo-1', 'my-repo')
    expect(task.repoId).toBe('repo-1')
    expect(task.status).toBe('pending')
  })

  it('获取任务', () => {
    const task = store.create('repo-1', 'my-repo')
    expect(store.get(task.id)).toBeDefined()
    expect(store.get(task.id)!.repoName).toBe('my-repo')
  })

  it('获取不存在的任务返回 undefined', () => {
    expect(store.get('non-existent')).toBeUndefined()
  })

  it('更新任务状态', () => {
    const task = store.create('repo-1', 'my-repo')
    store.update(task.id, { status: 'running', stage: 'scanning', step: 1, total: 5 })
    const updated = store.get(task.id)!
    expect(updated.status).toBe('running')
    expect(updated.stage).toBe('scanning')
  })

  it('列出任务', () => {
    store.create('repo-1', 'a')
    store.create('repo-1', 'b')
    expect(store.list()).toHaveLength(2)
  })

  it('按 repoId 过滤任务', () => {
    store.create('repo-1', 'a')
    store.create('repo-2', 'b')
    expect(store.listByRepo('repo-1')).toHaveLength(1)
  })

  it('取消任务', () => {
    const task = store.create('repo-1', 'my-repo')
    store.update(task.id, { status: 'running' })
    store.cancel(task.id)
    expect(store.get(task.id)!.status).toBe('canceled')
  })
})
