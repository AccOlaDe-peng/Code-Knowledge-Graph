import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GraphifyService } from '../src/services/graphify.service.js'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const TMP_DIR = join(import.meta.dirname, '__graphify_test_tmp__')

describe('GraphifyService', () => {
  let service: GraphifyService

  beforeEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
    mkdirSync(TMP_DIR, { recursive: true })
    service = new GraphifyService(5000)
  })

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
  })

  it('python3 不存在时抛出明确错误', async () => {
    const svc = new GraphifyService(2000)
    const origPath = process.env.PATH
    process.env.PATH = '/nonexistent'
    try {
      await expect(svc.run('/tmp', { mode: 'deep', update: false, directed: false }))
        .rejects.toThrow(/python3|graphify/)
    } finally {
      process.env.PATH = origPath
    }
  })

  it('构建正确的 spawn 参数 — 全量模式', () => {
    const svc = new GraphifyService()
    const args = svc.buildArgs('/path/to/repo', { mode: 'deep', update: false, directed: false })
    // First arg is the script path, second is the repo path
    expect(args[0]).toContain('graphify_pipeline.py')
    expect(args[1]).toBe('/path/to/repo')
    expect(args).toHaveLength(2)
  })

  it('构建正确的 spawn 参数 — 增量更新', () => {
    const svc = new GraphifyService()
    const args = svc.buildArgs('/path/to/repo', { mode: 'deep', update: true, directed: false })
    expect(args).toContain('--update')
  })

  it('构建正确的 spawn 参数 — 有向图', () => {
    const svc = new GraphifyService()
    const args = svc.buildArgs('/path/to/repo', { mode: 'deep', update: false, directed: true })
    expect(args).toContain('--directed')
  })

  it('进度映射 — detect → scanning', () => {
    const svc = new GraphifyService()
    expect(svc.mapStage('detect')).toBe('scanning')
  })

  it('进度映射 — extract → static_analysis', () => {
    const svc = new GraphifyService()
    expect(svc.mapStage('extract')).toBe('static_analysis')
  })

  it('进度映射 — build → graph_building', () => {
    const svc = new GraphifyService()
    expect(svc.mapStage('build')).toBe('graph_building')
  })

  it('进度映射 — cluster → semantic_analysis', () => {
    const svc = new GraphifyService()
    expect(svc.mapStage('cluster')).toBe('semantic_analysis')
  })

  it('进度映射 — report → reporting', () => {
    const svc = new GraphifyService()
    expect(svc.mapStage('report')).toBe('reporting')
  })

  it('进度映射 — 未知阶段返回原值', () => {
    const svc = new GraphifyService()
    expect(svc.mapStage('unknown_step')).toBe('unknown_step')
  })

  it('JSON 进度解析 — 正确解析 JSON 行', () => {
    const progress: Array<{ stage: string; step: number; total: number; message: string }> = []
    const svc = new GraphifyService()
    const callback = (stage: string, step: number, total: number, message: string) => {
      progress.push({ stage, step, total, message })
    }
    // Use the private method via any cast
    ;(svc as any).parseProgress(
      '{"step":1,"total":5,"stage":"detect","message":"Scanning..."}\n{"step":2,"total":5,"stage":"extract","message":"Extracting..."}\n',
      callback,
    )
    expect(progress).toHaveLength(2)
    expect(progress[0].stage).toBe('scanning')
    expect(progress[1].stage).toBe('static_analysis')
  })
})
