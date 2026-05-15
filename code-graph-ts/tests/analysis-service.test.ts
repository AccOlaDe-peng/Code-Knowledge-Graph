import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnalysisService } from '../src/services/analysis.service.js'
import { AnalysisStore } from '../src/stores/analysis-store.js'
import type { GitService, GitPrepareResult } from '../src/services/git.service.js'
import type { GraphifyService, GraphifyResult } from '../src/services/graphify.service.js'
import type { GraphStore } from '../src/stores/graph-store.js'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP_DIR = join(import.meta.dirname, '__analysis_test_tmp__')

/** 轮询等待任务达到终态 */
async function waitForTerminal(
  service: AnalysisService,
  taskId: string,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const t = service.getStatus(taskId)
    if (t && (t.status === 'completed' || t.status === 'failed' || t.status === 'canceled')) return
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(`Task ${taskId} did not reach terminal state within ${timeoutMs}ms`)
}

describe('AnalysisService', () => {
  let analysisStore: AnalysisStore
  let service: AnalysisService
  let mockGitService: GitService
  let mockGraphifyService: GraphifyService
  let mockGraphStore: GraphStore

  beforeEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
    mkdirSync(TMP_DIR, { recursive: true })

    analysisStore = new AnalysisStore()

    mockGitService = {
      prepareLocalPath: vi.fn().mockResolvedValue({
        localPath: TMP_DIR,
        gitCommit: 'abc123',
        isClone: false,
      } satisfies GitPrepareResult),
    } as unknown as GitService

    mockGraphifyService = {
      run: vi.fn().mockResolvedValue({
        graphJsonPath: join(TMP_DIR, 'graph.json'),
        reportPath: '',
        htmlPath: '',
        nodeCount: 10,
        edgeCount: 5,
      } satisfies GraphifyResult),
    } as unknown as GraphifyService

    mockGraphStore = {
      getNodeCount: vi.fn().mockReturnValue(0),
      addNode: vi.fn(),
      addEdge: vi.fn(),
      save: vi.fn(),
      getGraph: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
    } as unknown as GraphStore

    service = new AnalysisService(analysisStore, mockGitService, mockGraphifyService, mockGraphStore)
  })

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
  })

  it('submitAnalysis 创建任务并启动流水线，最终完成', async () => {
    writeFileSync(join(TMP_DIR, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }))

    const task = service.submitAnalysis('repo-1', 'my-repo', TMP_DIR)
    expect(task.id).toBeTruthy()
    expect(task.repoId).toBe('repo-1')

    await waitForTerminal(service, task.id)

    const finalTask = service.getStatus(task.id)!
    expect(finalTask.status).toBe('completed')
  })

  it('流水线依次调用 gitService → graphifyService → importToGraphStore', async () => {
    writeFileSync(join(TMP_DIR, 'graph.json'), JSON.stringify({
      nodes: [{ id: 'n1', label: 'N1', type: 'function' }],
      edges: [],
    }))

    service.submitAnalysis('repo-2', 'my-repo', TMP_DIR)

    await waitForTerminal(service, analysisStore.listByRepo('repo-2')[0].id)

    expect(mockGitService.prepareLocalPath).toHaveBeenCalledWith(TMP_DIR, undefined)
    expect(mockGraphifyService.run).toHaveBeenCalledWith(
      TMP_DIR,
      expect.objectContaining({ mode: 'deep', update: false, directed: false }),
      expect.any(Function),
      expect.any(AbortSignal),
    )
    expect(mockGraphStore.addNode).toHaveBeenCalled()
    expect(mockGraphStore.save).toHaveBeenCalledWith('repo-2')
  })

  it('cancelAnalysis 传递 abort signal', () => {
    const task = service.submitAnalysis('repo-1', 'my-repo', TMP_DIR)
    const canceled = service.cancelAnalysis(task.id)
    expect(canceled).toBeDefined()
    expect(canceled!.status).toBe('canceled')
  })

  it('同一仓库不并发分析', () => {
    service.submitAnalysis('repo-1', 'my-repo', TMP_DIR)
    const task2 = service.submitAnalysis('repo-1', 'my-repo', TMP_DIR)
    expect(task2.status).toBe('failed')
    expect(task2.error).toContain('already running')
  })

  it('流水线失败时任务标记为 failed', async () => {
    ;(mockGitService.prepareLocalPath as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('git error'))

    const task = service.submitAnalysis('repo-3', 'my-repo', '/bad-path')

    await waitForTerminal(service, task.id)

    const finalTask = service.getStatus(task.id)!
    expect(finalTask.status).toBe('failed')
    expect(finalTask.error).toContain('git error')
  })

  it('增量分析：已有图谱 + graphify-out 目录时设置 update=true', async () => {
    ;(mockGraphStore.getNodeCount as ReturnType<typeof vi.fn>).mockReturnValue(5)
    // 创建 graphify-out 目录使 existsSync 返回 true
    mkdirSync(join(TMP_DIR, 'graphify-out'), { recursive: true })
    writeFileSync(join(TMP_DIR, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }))

    const task = service.submitAnalysis('repo-4', 'my-repo', TMP_DIR)

    await waitForTerminal(service, task.id)

    expect(mockGraphifyService.run).toHaveBeenCalledWith(
      TMP_DIR,
      expect.objectContaining({ update: true }),
      expect.any(Function),
      expect.any(AbortSignal),
    )
  })

  it('全量分析：无已有图谱时设置 update=false', async () => {
    ;(mockGraphStore.getNodeCount as ReturnType<typeof vi.fn>).mockReturnValue(0)
    writeFileSync(join(TMP_DIR, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }))

    const task = service.submitAnalysis('repo-4b', 'my-repo', TMP_DIR)

    await waitForTerminal(service, task.id)

    expect(mockGraphifyService.run).toHaveBeenCalledWith(
      TMP_DIR,
      expect.objectContaining({ update: false }),
      expect.any(Function),
      expect.any(AbortSignal),
    )
  })

  it('DI 构造函数形式正常工作', () => {
    const deps = {
      analysisStore,
      gitService: mockGitService,
      graphifyService: mockGraphifyService,
      graphStore: mockGraphStore,
    }
    const svc = new AnalysisService(deps)
    const task = svc.submitAnalysis('repo-d1', 'di-repo', TMP_DIR)
    expect(task.id).toBeTruthy()
    expect(task.repoId).toBe('repo-d1')
  })

  it('setRepoService 注入 RepoService', async () => {
    writeFileSync(join(TMP_DIR, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }))

    const mockRepoService = {
      updateRepo: vi.fn().mockReturnValue(undefined),
    }

    service.setRepoService(mockRepoService as any)

    const task = service.submitAnalysis('repo-5', 'my-repo', TMP_DIR)

    await waitForTerminal(service, task.id)

    expect(mockRepoService.updateRepo).toHaveBeenCalledWith(
      'repo-5',
      expect.objectContaining({ status: 'completed', gitCommit: 'abc123' }),
    )
  })

  it('listAnalyses 返回指定仓库的任务', () => {
    service.submitAnalysis('repo-6', 'repo-a', TMP_DIR)
    service.submitAnalysis('repo-7', 'repo-b', TMP_DIR)

    const listA = service.listAnalyses('repo-6')
    expect(listA.length).toBeGreaterThanOrEqual(1)
    expect(listA.every(t => t.repoId === 'repo-6')).toBe(true)
  })

  it('progress callback 更新任务阶段', async () => {
    writeFileSync(join(TMP_DIR, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }))

    let capturedProgress: { stage: string; step: number; total: number } | null = null
    ;(mockGraphifyService.run as ReturnType<typeof vi.fn>).mockImplementation(
      (_path: string, _opts: unknown, onProgress?: (stage: string, step: number, total: number, message: string) => void) => {
        if (onProgress) {
          onProgress('static_analysis', 2, 5, '解析 AST...')
          capturedProgress = { stage: 'static_analysis', step: 2, total: 5 }
        }
        return Promise.resolve({
          graphJsonPath: join(TMP_DIR, 'graph.json'),
          reportPath: '',
          htmlPath: '',
          nodeCount: 0,
          edgeCount: 0,
        })
      },
    )

    const task = service.submitAnalysis('repo-8', 'my-repo', TMP_DIR)

    await waitForTerminal(service, task.id)

    // 验证 progress 回调被调用过
    expect(capturedProgress).not.toBeNull()
    expect(capturedProgress!.stage).toBe('static_analysis')
  })

  it('SSE broadcast 被调用', async () => {
    writeFileSync(join(TMP_DIR, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }))

    const broadcastFn = vi.fn()
    const mockBroadcaster = { subscribe: vi.fn(), broadcast: broadcastFn }
    service.setBroadcaster(mockBroadcaster as any)

    const task = service.submitAnalysis('repo-9', 'my-repo', TMP_DIR)

    await waitForTerminal(service, task.id)

    expect(broadcastFn).toHaveBeenCalled()
    // 至少一次 done
    const calls = broadcastFn.mock.calls
    const hasDone = calls.some((c: unknown[]) => c[1] === 'done')
    expect(hasDone).toBe(true)
  })

  it('getStatus 返回 undefined 对不存在的任务', () => {
    expect(service.getStatus('non-existent')).toBeUndefined()
  })
})
