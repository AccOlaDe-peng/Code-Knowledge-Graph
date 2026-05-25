import { useState, useEffect, useRef, useCallback } from 'react'
import type { AnalysisProgressEvent } from '../../types/api'
import { graphEndpoints } from '../api/endpoints/graph'

const POLL_INTERVAL_MS = 2000 // 2秒轮询间隔

export interface AnalysisStreamResult {
  /** 当前正在执行或最近完成的步骤事件 */
  currentStep: AnalysisProgressEvent | null
  /** 已完成的步骤列表 */
  completedSteps: AnalysisProgressEvent[]
  /** 最终结果（status === 'completed' 或 'failed'） */
  finalResult: AnalysisProgressEvent | null
  /** 是否正在轮询 */
  isConnected: boolean
}

/**
 * 轮询分析任务进度（替代 SSE）。
 * taskId 为 null 时停止轮询。
 * taskId 变更时自动重新开始轮询。
 */
export function useAnalysisStream(taskId: string | null): AnalysisStreamResult {
  const [currentStep, setCurrentStep] = useState<AnalysisProgressEvent | null>(null)
  const [completedSteps, setCompletedSteps] = useState<AnalysisProgressEvent[]>([])
  const [finalResult, setFinalResult] = useState<AnalysisProgressEvent | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  const taskIdRef = useRef<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleEvent = useCallback((event: AnalysisProgressEvent) => {
    const { status } = event

    if (status === 'running' || status === 'pending') {
      setCurrentStep(event)
      return
    }

    if ('step' in event && event.step !== undefined) {
      setCurrentStep(event)
      setCompletedSteps(prev => {
        const exists = prev.some(e => e.step === event.step && e.stage === event.stage)
        return exists ? prev : [...prev, event]
      })
      return
    }

    if (status === 'completed' || status === 'failed' || status === 'canceled') {
      setFinalResult(event)
      // 停止轮询
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setIsConnected(false)
    }
  }, [])

  const pollStatus = useCallback(async (tid: string) => {
    try {
      const state = await graphEndpoints.getAnalysisStatus(tid)
      handleEvent(state as AnalysisProgressEvent)
    } catch {
      // 轮询失败时忽略，继续下次轮询
    }
  }, [handleEvent])

  useEffect(() => {
    if (!taskId) {
      // taskId 清空时停止轮询并重置状态
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      taskIdRef.current = null
      setCurrentStep(null)
      setCompletedSteps([])
      setFinalResult(null)
      setIsConnected(false)
      return
    }

    if (taskId === taskIdRef.current) return // 同一个 taskId 不重复启动

    // 停止旧轮询
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    taskIdRef.current = taskId

    // 重置状态
    setCurrentStep(null)
    setCompletedSteps([])
    setFinalResult(null)
    setIsConnected(true)

    // 立即发起第一次请求
    pollStatus(taskId)

    // 开始轮询
    intervalRef.current = setInterval(() => {
      pollStatus(taskId)
    }, POLL_INTERVAL_MS)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setIsConnected(false)
    }
  }, [taskId, pollStatus])

  return { currentStep, completedSteps, finalResult, isConnected }
}