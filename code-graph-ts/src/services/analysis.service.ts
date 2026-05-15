import { AnalysisStore } from '../stores/analysis-store.js'
import type { AnalysisTask } from '../types/repo.js'
import type { SSEBroadcaster } from '../utils/sse.js'
import type { AnalysisProgressEvent } from '../types/api.js'

export class AnalysisService {
  private broadcaster: SSEBroadcaster | null = null
  private analysisStore: AnalysisStore

  constructor(analysisStore: AnalysisStore) {
    this.analysisStore = analysisStore
  }

  setBroadcaster(broadcaster: SSEBroadcaster): void {
    this.broadcaster = broadcaster
  }

  submitAnalysis(repoId: string, repoName: string): AnalysisTask {
    const task = this.analysisStore.create(repoId, repoName)
    this.simulateAnalysis(task.id)
    return task
  }

  getStatus(taskId: string): AnalysisTask | undefined {
    return this.analysisStore.get(taskId)
  }

  cancelAnalysis(taskId: string): AnalysisTask | undefined {
    return this.analysisStore.cancel(taskId)
  }

  listAnalyses(repoId: string): AnalysisTask[] {
    return this.analysisStore.listByRepo(repoId)
  }

  private simulateAnalysis(taskId: string): void {
    const stages = [
      { stage: 'scanning', message: '扫描文件树...' },
      { stage: 'static_analysis', message: '解析 AST...' },
      { stage: 'semantic_analysis', message: '语义分析...' },
      { stage: 'graph_building', message: '构建图谱...' },
      { stage: 'reporting', message: '生成报告...' },
    ]

    const total = stages.length
    let step = 0

    const emit = (event: string, data: AnalysisProgressEvent) => {
      this.broadcaster?.broadcast(taskId, event, data)
    }

    const tick = () => {
      step++
      if (step > total) return

      const current = stages[step - 1]
      const isLast = step === total

      const data: AnalysisProgressEvent = {
        status: isLast ? 'completed' : 'running',
        step,
        total,
        stage: current.stage,
        message: current.message,
        elapsed_seconds: step * 2,
        ...(isLast ? { graph_id: taskId, node_count: 0, edge_count: 0 } : {}),
      }

      this.analysisStore.update(taskId, {
        status: data.status,
        step: data.step,
        total: data.total,
        stage: data.stage,
        message: data.message,
        elapsedSeconds: data.elapsed_seconds,
        ...(isLast ? { graphId: taskId, nodeCount: 0, edgeCount: 0 } : {}),
      })

      emit(isLast ? 'done' : 'progress', data)

      if (!isLast) {
        setTimeout(tick, 500)
      }
    }

    setTimeout(tick, 200)
  }
}
