import type { AnalysisProgressEvent } from '../types/api.js'

export function createSSEBroadcaster() {
  const listeners: Map<string, Array<(event: string, data: AnalysisProgressEvent) => void>> = new Map()

  function subscribe(taskId: string, handler: (event: string, data: AnalysisProgressEvent) => void): () => void {
    if (!listeners.has(taskId)) listeners.set(taskId, [])
    listeners.get(taskId)!.push(handler)
    return () => {
      const arr = listeners.get(taskId)
      if (arr) {
        const idx = arr.indexOf(handler)
        if (idx >= 0) arr.splice(idx, 1)
        if (arr.length === 0) listeners.delete(taskId)
      }
    }
  }

  function broadcast(taskId: string, event: string, data: AnalysisProgressEvent): void {
    const handlers = listeners.get(taskId)
    if (handlers) {
      for (const handler of handlers) handler(event, data)
    }
  }

  return { subscribe, broadcast }
}

export type SSEBroadcaster = ReturnType<typeof createSSEBroadcaster>
