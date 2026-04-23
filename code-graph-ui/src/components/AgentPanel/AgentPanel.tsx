/**
 * AgentPanel — Agent 探索状态面板。
 *
 * 显示 Agent 当前状态、探索进度、最近发现，
 * 并提供用户引导输入框。
 */

import React, { useState, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentStatus = {
  agent_id: string
  graph_id: string
  state: 'idle' | 'running' | 'waiting_guide' | 'stopped' | 'completed' | 'error'
  iteration: number
  discoveries_count: number
  current_focus: string | null
  recent_discoveries: Array<{
    iteration: number
    tool: string
    result: Record<string, unknown>
  }>
}

export type AgentEvent = {
  type: string
  data: Record<string, unknown>
  timestamp: string
}

type AgentPanelProps = {
  graphId: string
  apiBase?: string
  onFocusNode?: (nodeId: string) => void
}

// ─── State Colors ──────────────────────────────────────────────────────────────

const STATE_COLORS: Record<string, string> = {
  idle: '#888',
  running: '#00d4ff',
  waiting_guide: '#ffc145',
  stopped: '#ff6b6b',
  completed: '#00f084',
  error: '#ff4444',
}

const STATE_LABELS: Record<string, string> = {
  idle: '空闲',
  running: '探索中',
  waiting_guide: '等待引导',
  stopped: '已停止',
  completed: '已完成',
  error: '错误',
}

// ─── AgentPanel ────────────────────────────────────────────────────────────────

const AgentPanel: React.FC<AgentPanelProps> = ({
  graphId,
  apiBase = 'http://localhost:8000',
  onFocusNode,
}) => {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [guideInput, setGuideInput] = useState('')
  const [mode, setMode] = useState<'autonomous' | 'guided'>('guided')
  const [target, setTarget] = useState('')
  const [loading, setLoading] = useState(false)

  // Start agent
  const startAgent = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/agent/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph_id: graphId,
          mode,
          target: mode === 'guided' ? target : undefined,
        }),
      })
      const data = await res.json()
      setStatus(data)
      // Start SSE stream
      connectStream(data.agent_id)
    } catch (err) {
      console.error('Failed to start agent:', err)
    } finally {
      setLoading(false)
    }
  }, [apiBase, graphId, mode, target])

  // Connect to SSE stream
  const connectStream = useCallback((agentId: string) => {
    const evtSource = new EventSource(`${apiBase}/agent/stream/${agentId}`)
    evtSource.onmessage = (e) => {
      try {
        const event: AgentEvent = JSON.parse(e.data)
        if (event.type === 'heartbeat') return
        setEvents((prev) => [...prev.slice(-49), event])

        if (event.type === 'discovery' && event.data.result) {
          const nodeId = (event.data.result as Record<string, unknown>)?.node_id as string | undefined
          if (nodeId && onFocusNode) onFocusNode(nodeId)
        }

        if (['completed', 'error', 'stopping'].includes(event.type)) {
          evtSource.close()
        }
      } catch { /* ignore parse errors */ }
    }
    evtSource.onerror = () => evtSource.close()
  }, [apiBase, onFocusNode])

  // Send guide message
  const sendGuide = useCallback(async () => {
    if (!status?.agent_id || !guideInput.trim()) return
    try {
      await fetch(`${apiBase}/agent/guide/${status.agent_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: guideInput.trim() }),
      })
      setGuideInput('')
    } catch (err) {
      console.error('Failed to send guide:', err)
    }
  }, [apiBase, status, guideInput])

  // Stop agent
  const stopAgent = useCallback(async () => {
    if (!status?.agent_id) return
    try {
      await fetch(`${apiBase}/agent/stop/${status.agent_id}`, { method: 'POST' })
    } catch (err) {
      console.error('Failed to stop agent:', err)
    }
  }, [apiBase, status])

  // Poll status
  useEffect(() => {
    if (!status?.agent_id) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${apiBase}/agent/status/${status.agent_id}`)
        const data = await res.json()
        setStatus(data)
        if (['completed', 'stopped', 'error'].includes(data.state)) {
          clearInterval(interval)
        }
      } catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(interval)
  }, [apiBase, status?.agent_id])

  const stateColor = STATE_COLORS[status?.state ?? 'idle'] ?? '#888'
  const stateLabel = STATE_LABELS[status?.state ?? 'idle'] ?? status?.state

  return (
    <div style={{
      background: 'var(--s-raised)',
      border: '1px solid var(--b-faint)',
      borderRadius: 'var(--radius-m)',
      padding: 20,
      fontFamily: 'var(--font-ui)',
      color: 'var(--t-primary)',
      fontSize: 14,
      maxHeight: 500,
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: stateColor,
          boxShadow: `0 0 8px ${stateColor}60`,
        }} />
        <span style={{ fontWeight: 600, fontSize: 16 }}>Graph Explorer</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: stateColor, marginLeft: 'auto',
        }}>
          {stateLabel}
        </span>
      </div>

      {/* Start controls (shown when idle) */}
      {!status || status.state === 'idle' ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setMode('autonomous')}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 6,
                border: mode === 'autonomous' ? `1px solid var(--a-cyan)` : '1px solid var(--b-faint)',
                background: mode === 'autonomous' ? 'rgba(0,212,255,0.1)' : 'transparent',
                color: mode === 'autonomous' ? 'var(--a-cyan)' : 'var(--t-secondary)',
                cursor: 'pointer', fontSize: 13,
              }}
            >
              自主探索
            </button>
            <button
              onClick={() => setMode('guided')}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 6,
                border: mode === 'guided' ? `1px solid var(--a-cyan)` : '1px solid var(--b-faint)',
                background: mode === 'guided' ? 'rgba(0,212,255,0.1)' : 'transparent',
                color: mode === 'guided' ? 'var(--a-cyan)' : 'var(--t-secondary)',
                cursor: 'pointer', fontSize: 13,
              }}
            >
              引导探索
            </button>
          </div>

          {mode === 'guided' && (
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="目标描述，如：分析 auth 模块"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid var(--b-faint)', background: 'var(--s-void)',
                color: 'var(--t-primary)', fontSize: 13, marginBottom: 12,
                boxSizing: 'border-box',
              }}
            />
          )}

          <button
            onClick={startAgent}
            disabled={loading}
            style={{
              width: '100%', padding: '10px 16px', borderRadius: 6,
              border: 'none', background: 'var(--a-cyan)', color: '#07090d',
              fontWeight: 600, fontSize: 14, cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? '启动中...' : '开始探索'}
          </button>
        </div>
      ) : null}

      {/* Stats */}
      {status && status.state !== 'idle' && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 600 }}>
                {status.iteration}
              </div>
              <div style={{ fontSize: 12, color: 'var(--t-secondary)' }}>迭代</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 600, color: 'var(--a-green)' }}>
                {status.discoveries_count}
              </div>
              <div style={{ fontSize: 12, color: 'var(--t-secondary)' }}>发现</div>
            </div>
          </div>

          {/* Current focus */}
          {status.current_focus && (
            <div style={{
              padding: '8px 12px', borderRadius: 6,
              background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)',
              marginBottom: 12, fontSize: 12, fontFamily: 'var(--font-mono)',
            }}>
              <span style={{ color: 'var(--t-secondary)' }}>聚焦: </span>
              <span style={{ color: 'var(--a-cyan)' }}>{status.current_focus}</span>
            </div>
          )}

          {/* Guide input */}
          {(status.state === 'running' || status.state === 'waiting_guide') && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                value={guideInput}
                onChange={(e) => setGuideInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendGuide()}
                placeholder="引导 Agent，如：跳过测试文件"
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 6,
                  border: '1px solid var(--b-faint)', background: 'var(--s-void)',
                  color: 'var(--t-primary)', fontSize: 13, boxSizing: 'border-box',
                }}
              />
              <button
                onClick={sendGuide}
                style={{
                  padding: '8px 12px', borderRadius: 6,
                  border: '1px solid var(--a-cyan)', background: 'rgba(0,212,255,0.1)',
                  color: 'var(--a-cyan)', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
                }}
              >
                发送
              </button>
            </div>
          )}

          {/* Stop button */}
          {status.state === 'running' && (
            <button
              onClick={stopAgent}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid #ff6b6b', background: 'rgba(255,107,107,0.1)',
                color: '#ff6b6b', cursor: 'pointer', fontSize: 13, marginBottom: 12,
              }}
            >
              停止探索
            </button>
          )}

          {/* Recent events */}
          {events.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--t-secondary)', marginBottom: 8 }}>
                最近事件
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {events.slice(-10).reverse().map((evt, i) => (
                  <div key={i} style={{
                    padding: '4px 8px', marginBottom: 4,
                    borderRadius: 4, fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    background: evt.type === 'discovery' ? 'rgba(0,240,132,0.08)' :
                      evt.type === 'tool_call' ? 'rgba(0,212,255,0.08)' :
                      evt.type === 'error' ? 'rgba(255,68,68,0.08)' : 'transparent',
                  }}>
                    <span style={{ color: 'var(--t-secondary)' }}>
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                    {' '}
                    <span style={{ color: evt.type === 'discovery' ? 'var(--a-green)' : evt.type === 'error' ? '#ff4444' : 'var(--a-cyan)' }}>
                      {evt.type}
                    </span>
                    {evt.type === 'tool_call' && `: ${evt.data.tool}`}
                    {evt.type === 'discovery' && `: ${JSON.stringify(evt.data.result || {}).slice(0, 60)}`}
                    {evt.type === 'thinking' && `: ${(evt.data.text as string || '').slice(0, 80)}`}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default AgentPanel
