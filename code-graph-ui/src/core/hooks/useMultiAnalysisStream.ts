import { useCallback, useEffect, useRef } from 'react'
import type { AnalysisProgressEvent } from '../../types/api'
import { graphEndpoints } from '../api/endpoints/graph'
import { useRepoStore } from '../../store/repoStore'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

/**
 * 多任务 SSE 管理器
 * 支持同时订阅多个分析任务的进度流
 */
export function useMultiAnalysisStream() {
  const managerRef = useRef<Map<string, { es: EventSource; repoId: string }> | null>(null)
  const updateRepo = useRepoStore((s) => s.updateRepo)

  // 断线恢复
  const recoverState = useCallback(
    async (taskId: string, repoId: string) => {
      try {
        const state = await graphEndpoints.getAnalysisStatus(taskId)
        updateRepo(repoId, {
          analysisStep: state.step,
          analysisTotal: state.total,
          analysisStage: state.stage,
          analysisMessage: state.message,
        })
        if (state.status === 'completed' || state.status === 'failed') {
          updateRepo(repoId, { status: state.status, taskId: undefined })
          managerRef.current?.get(taskId)?.es.close()
          managerRef.current?.delete(taskId)
        }
      } catch {
        // 恢复失败，等待 EventSource 自动重连
      }
    },
    [updateRepo]
  )

  // 组件卸载时清理所有连接
  useEffect(() => {
    return () => {
      managerRef.current?.forEach((stream) => stream.es.close())
      managerRef.current = null
    }
  }, [])

  const subscribe = useCallback(
    (taskId: string, repoId: string) => {
      if (!managerRef.current) {
        managerRef.current = new Map()
      }
      if (managerRef.current.has(taskId)) return

      const url = `${API_BASE}/analyze/stream/${taskId}`
      const es = new EventSource(url)
      managerRef.current.set(taskId, { es, repoId })

      // 监听 progress 事件
      es.addEventListener('progress', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as AnalysisProgressEvent
          updateRepo(repoId, {
            analysisStep: event.step,
            analysisTotal: event.total,
            analysisStage: event.stage,
            analysisMessage: event.message,
          })

          if (event.status === 'completed' || event.status === 'failed') {
            updateRepo(repoId, {
              status: event.status,
              taskId: undefined,
              graphId: event.graph_id ?? undefined,
            })
            es.close()
            managerRef.current?.delete(taskId)
          }
        } catch {
          // 忽略解析错误
        }
      })

      // 监听 done 事件
      es.addEventListener('done', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as AnalysisProgressEvent
          // 只有 terminal states 才更新 repo status
          if (event.status === 'completed' || event.status === 'failed' || event.status === 'canceled') {
            updateRepo(repoId, {
              status: event.status,
              taskId: undefined,
              graphId: event.graph_id ?? undefined,
            })
          }
          es.close()
          managerRef.current?.delete(taskId)
        } catch {
          // 忽略解析错误
        }
      })

      es.onerror = () => {
        if (managerRef.current?.has(taskId)) {
          recoverState(taskId, repoId)
        }
      }
    },
    [updateRepo, recoverState]
  )

  const unsubscribe = useCallback((taskId: string) => {
    const stream = managerRef.current?.get(taskId)
    if (stream) {
      stream.es.close()
      managerRef.current?.delete(taskId)
    }
  }, [])

  return { subscribe, unsubscribe }
}
