import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GraphifyService } from '../src/services/graphify.service.js'
import type { GraphifyOptions } from '../src/services/graphify.service.js'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
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

  it('graphify 不存在时抛出明确错误', async () => {
    const svc = new GraphifyService(2000)
    const origPath = process.env.PATH
    process.env.PATH = '/nonexistent'
    try {
      await expect(svc.run('/tmp', { mode: 'deep', update: false, directed: false }))
        .rejects.toThrow(/graphify/)
    } finally {
      process.env.PATH = origPath
    }
  })

  it('构建正确的 spawn 参数 — 全量 deep 模式', () => {
    const service = new GraphifyService()
    const args = service.buildArgs('/path/to/repo', { mode: 'deep', update: false, directed: false })
    expect(args).toEqual(['/path/to/repo', '--mode', 'deep'])
  })

  it('构建正确的 spawn 参数 — 增量更新', () => {
    const service = new GraphifyService()
    const args = service.buildArgs('/path/to/repo', { mode: 'deep', update: true, directed: false })
    expect(args).toEqual(['/path/to/repo', '--mode', 'deep', '--update'])
  })

  it('构建正确的 spawn 参数 — 有向图', () => {
    const service = new GraphifyService()
    const args = service.buildArgs('/path/to/repo', { mode: 'deep', update: false, directed: true })
    expect(args).toEqual(['/path/to/repo', '--mode', 'deep', '--directed'])
  })

  it('进度映射 — detect → scanning', () => {
    const service = new GraphifyService()
    expect(service.mapStage('detect')).toBe('scanning')
  })

  it('进度映射 — extract → static_analysis', () => {
    const service = new GraphifyService()
    expect(service.mapStage('extract')).toBe('static_analysis')
  })

  it('进度映射 — semantic → semantic_analysis', () => {
    const service = new GraphifyService()
    expect(service.mapStage('semantic')).toBe('semantic_analysis')
  })

  it('进度映射 — build → graph_building', () => {
    const service = new GraphifyService()
    expect(service.mapStage('build')).toBe('graph_building')
  })

  it('进度映射 — report → reporting', () => {
    const service = new GraphifyService()
    expect(service.mapStage('report')).toBe('reporting')
  })

  it('进度映射 — 未知阶段返回原值', () => {
    const service = new GraphifyService()
    expect(service.mapStage('unknown_step')).toBe('unknown_step')
  })
})
