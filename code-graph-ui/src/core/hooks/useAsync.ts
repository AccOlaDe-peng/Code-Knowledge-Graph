import { useState, useCallback, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AsyncState<T> = {
  data: T | null
  loading: boolean
  error: Error | null
}

export type AsyncActions<T> = {
  execute: (...args: unknown[]) => Promise<T>
  reset: () => void
  setData: (data: T | null) => void
}

export type UseAsyncReturn<T> = AsyncState<T> & AsyncActions<T>

// ─── useAsync Hook ────────────────────────────────────────────────────────────

export function useAsync<T>(
  asyncFunction: (...args: unknown[]) => Promise<T>,
  immediate = false
): UseAsyncReturn<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: immediate,
    error: null,
  })

  const execute = useCallback(
    async (...args: unknown[]) => {
      setState({ data: null, loading: true, error: null })

      try {
        const data = await asyncFunction(...args)
        setState({ data, loading: false, error: null })
        return data
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        setState({ data: null, loading: false, error: err })
        throw err
      }
    },
    [asyncFunction]
  )

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null })
  }, [])

  const setData = useCallback((data: T | null) => {
    setState(prev => ({ ...prev, data }))
  }, [])

  useEffect(() => {
    if (immediate) {
      execute()
    }
  }, [immediate, execute])

  return {
    ...state,
    execute,
    reset,
    setData,
  }
}

export default useAsync
