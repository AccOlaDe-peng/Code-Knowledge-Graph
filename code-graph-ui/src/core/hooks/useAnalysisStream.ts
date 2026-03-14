import { useState, useEffect, useRef, useCallback } from 'react'
import type { AnalysisProgressEvent } from '../../types/api'
import { graphEndpoints } from '../api/endpoints/graph'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export interface AnalysisStreamResult {
  /** 当前正在执行或最近完成的步骤事件 */
  currentStep: AnalysisProgressEvent | null
  /** 已完成的步骤列表（status === 'step_done' 的事件） */
  completedSteps: AnalysisProgressEvent[]
  /** 最终结果（status === 'completed' 或 'failed'） */
  finalResult: AnalysisProgressEvent | null
  /** SSE 是否已连接 */
  isConnected: boolean
}

/**
 * 订阅分析任务进度 SSE 流。
 * taskId 为 null 时不建立连接。
 * taskId 变更时自动关闭旧连接并建立新连接。
 */
export function useAnalysisStream(taskId: string | null): AnalysisStreamResult {
  const [currentStep,    setCurrentStep]    = useState<AnalysisProgressEvent | null>(null)
  const [completedSteps, setCompletedSteps] = useState<AnalysisProgressEvent[]>([])
  const [finalResult,    setFinalResult]    = useState<AnalysisProgressEvent | null>(null)
  const [isConnected,    setIsConnected]    = useState(false)

  const esRef       = useRef<EventSource | null>(null)
  const taskIdRef   = useRef<string | null>(null)

  const handleEvent = useCallback((event: AnalysisProgressEvent) => {
    const { status } = event

    if (status === 'running') {
      setCurrentStep(event)
      return
    }

    // Handle step_done if it exists in the status union
    if ('step' in event && event.step !== undefined) {
      setCurrentStep(event)
      setCompletedSteps(prev => {
        // 避免重复（断线重连可能重发）
        const exists = prev.some(e => e.step === event.step && e.stage === event.stage)
        return exists ? prev : [...prev, event]
      })
      return
    }

    if (status === 'completed' || status === 'failed') {
      setFinalResult(event)
      // 关闭连接
      esRef.current?.close()
      esRef.current = null
      setIsConnected(false)
      return
    }

    if (status === 'pending') {
      setCurrentStep(event)
    }
  }, [])

  // 断线重连时，调 REST 接口恢复最新状态
  const recoverState = useCallback(async (tid: string) => {
    try {
      const state = await graphEndpoints.getAnalysisStatus(tid)
      if (state.status === 'completed' || state.status === 'failed') {
        setFinalResult(state as AnalysisProgressEvent)
        esRef.current?.close()
        esRef.current = null
        setIsConnected(false)
      } else {
        handleEvent(state as AnalysisProgressEvent)
      }
    } catch {
      // 恢复失败时不处理，等待 EventSource 重连
    }
  }, [handleEvent])

  useEffect(() => {
    if (!taskId) {
      // taskId 清空时重置所有状态
      esRef.current?.close()
      esRef.current = null
      taskIdRef.current = null
      setCurrentStep(null)
      setCompletedSteps([])
      setFinalResult(null)
      setIsConnected(false)
      return
    }

    if (taskId === taskIdRef.current) return  // 同一个 taskId 不重复连接

    // 关闭旧连接
    esRef.current?.close()
    taskIdRef.current = taskId

    // 重置状态
    setCurrentStep(null)
    setCompletedSteps([])
    setFinalResult(null)

    // 建立新 SSE 连接
    const url = `${API_BASE}/analyze/stream/${taskId}`
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => setIsConnected(true)

    es.onmessage = (e) => {
      try {
        const event: AnalysisProgressEvent = JSON.parse(e.data)
        handleEvent(event)
      } catch {
        // 忽略非 JSON 消息（如 heartbeat 注释行不会触发 onmessage）
      }
    }

    es.onerror = () => {
      setIsConnected(false)
      // EventSource 会自动重连；重连时恢复最新状态
      if (taskIdRef.current) {
        recoverState(taskIdRef.current)
      }
    }

    return () => {
      es.close()
      esRef.current = null
      setIsConnected(false)
    }
  }, [taskId, handleEvent, recoverState])

  return { currentStep, completedSteps, finalResult, isConnected }
}
