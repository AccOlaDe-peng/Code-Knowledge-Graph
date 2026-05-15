import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AnalysisStore } from '../stores/analysis-store.js'
import type { AnalysisTask } from '../types/repo.js'
import type { SSEBroadcaster } from '../utils/sse.js'
import type { AnalysisProgressEvent } from '../types/api.js'
import type { GitService } from './git.service.js'
import type { GraphifyService, GraphifyOptions } from './graphify.service.js'
import type { GraphStore } from '../stores/graph-store.js'
import { importToGraphStore } from './graph-import.js'
import type { RepoService } from './repo.service.js'

interface AnalysisServiceDeps {
  analysisStore: AnalysisStore
  gitService: GitService
  graphifyService: GraphifyService
  graphStore: GraphStore
  repoService?: RepoService
}

export class AnalysisService {
  private broadcaster: SSEBroadcaster | null = null
  private deps: AnalysisServiceDeps
  private activeAbortControllers: Map<string, AbortController> = new Map()

  constructor(deps: AnalysisServiceDeps)
  constructor(analysisStore: AnalysisStore, gitService: GitService, graphifyService: GraphifyService, graphStore: GraphStore)
  constructor(analysisStoreOrDeps: AnalysisStore | AnalysisServiceDeps, gitService?: GitService, graphifyService?: GraphifyService, graphStore?: GraphStore) {
    if ('analysisStore' in analysisStoreOrDeps && !(analysisStoreOrDeps instanceof AnalysisStore)) {
      this.deps = analysisStoreOrDeps
    } else {
      this.deps = {
        analysisStore: analysisStoreOrDeps as AnalysisStore,
        gitService: gitService!,
        graphifyService: graphifyService!,
        graphStore: graphStore!,
      }
    }
  }

  setBroadcaster(broadcaster: SSEBroadcaster): void {
    this.broadcaster = broadcaster
  }

  setRepoService(repoService: RepoService): void {
    this.deps.repoService = repoService
  }

  submitAnalysis(repoId: string, repoName: string, repoPath?: string, branch?: string): AnalysisTask {
    const store = this.deps.analysisStore

    // 并发控制：同一仓库已有 running 任务
    const runningTasks = store.listByRepo(repoId).filter(t => t.status === 'running' || t.status === 'pending')
    if (runningTasks.length > 0) {
      const task = store.create(repoId, repoName)
      store.update(task.id, {
        status: 'failed',
        error: `Analysis already running for repo ${repoId}`,
      })
      return store.get(task.id)!
    }

    const task = store.create(repoId, repoName)
    const abortController = new AbortController()
    this.activeAbortControllers.set(task.id, abortController)

    this.executePipeline(task.id, repoPath ?? '', branch).catch((err) => {
      this.updateTask(task.id, {
        status: 'failed',
        error: err.message ?? 'Unknown error',
      })
    })

    return task
  }

  getStatus(taskId: string): AnalysisTask | undefined {
    return this.deps.analysisStore.get(taskId)
  }

  cancelAnalysis(taskId: string): AnalysisTask | undefined {
    const abortController = this.activeAbortControllers.get(taskId)
    if (abortController) {
      abortController.abort()
      this.activeAbortControllers.delete(taskId)
    }
    return this.deps.analysisStore.cancel(taskId)
  }

  listAnalyses(repoId: string): AnalysisTask[] {
    return this.deps.analysisStore.listByRepo(repoId)
  }

  private async executePipeline(taskId: string, repoPath: string, branch?: string): Promise<void> {
    const { gitService, graphifyService, graphStore, analysisStore, repoService } = this.deps

    // Stage 1: Git preparation
    this.updateTask(taskId, { status: 'running', stage: 'scanning', step: 1, total: 5, message: '准备代码路径...' })
    const gitResult = await gitService.prepareLocalPath(repoPath, branch)

    // Stage 2: Determine incremental vs full
    const repoId = analysisStore.get(taskId)!.repoId
    const hasExistingGraph = graphStore.getNodeCount(repoId) > 0
    const hasGraphifyOutput = existsSync(join(gitResult.localPath, 'graphify-out'))
    const isUpdate = hasExistingGraph && hasGraphifyOutput

    // Stage 3: Run graphify
    this.updateTask(taskId, { stage: 'static_analysis', step: 2, total: 5, message: isUpdate ? '增量分析...' : '全量分析...' })

    const options: GraphifyOptions = {
      mode: 'deep',
      update: isUpdate,
      directed: false,
    }

    const abortController = this.activeAbortControllers.get(taskId)

    const result = await graphifyService.run(
      gitResult.localPath,
      options,
      (stage, step, total, message) => {
        this.updateTask(taskId, { stage, step, total, message })
        this.broadcast(taskId, 'progress', {
          status: 'running',
          stage,
          step,
          total,
          message,
          elapsed_seconds: 0,
        })
      },
      abortController?.signal,
    )

    // Stage 4: Import results
    this.updateTask(taskId, { stage: 'reporting', step: 4, total: 5, message: '导入图谱数据...' })

    importToGraphStore(result, repoId, graphStore)

    // Stage 5: Finalize
    const graphData = graphStore.getGraph(repoId)
    const nodeCount = graphData.nodes.length
    const edgeCount = graphData.edges.length

    this.updateTask(taskId, {
      status: 'completed',
      stage: 'reporting',
      step: 5,
      total: 5,
      message: '分析完成',
      graphId: repoId,
      nodeCount,
      edgeCount,
    })

    // Update repo info
    if (repoService) {
      repoService.updateRepo(repoId, {
        status: 'completed',
        graphId: repoId,
        nodeCount,
        edgeCount,
        gitCommit: gitResult.gitCommit,
        lastAnalyzedAt: new Date().toISOString(),
        taskId,
        stage: 'reporting',
        step: 5,
        total: 5,
        message: '分析完成',
      })
    }

    this.broadcast(taskId, 'done', {
      status: 'completed',
      graph_id: repoId,
      node_count: nodeCount,
      edge_count: edgeCount,
    })

    this.activeAbortControllers.delete(taskId)
  }

  private updateTask(taskId: string, patch: Partial<Omit<AnalysisTask, 'id' | 'createdAt'>>): void {
    this.deps.analysisStore.update(taskId, patch)
  }

  private broadcast(taskId: string, event: string, data: AnalysisProgressEvent): void {
    this.broadcaster?.broadcast(taskId, event, data)
  }
}
