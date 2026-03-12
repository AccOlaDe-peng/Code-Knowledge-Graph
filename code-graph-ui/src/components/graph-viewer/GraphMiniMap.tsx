import React, { useCallback, useEffect, useRef } from 'react'
import { useGraphEngineStore } from '../../graph-engine/store'
import { getNodeTypeColor } from '../../theme'

// ─── Constants ────────────────────────────────────────────────────────────────

const MAP_W = 180
const MAP_H = 120
const NODE_DOT_RADIUS = 1.5
const VIEWPORT_STROKE = 'rgba(0,212,255,0.7)'
const BG_COLOR = '#07090d'
const BORDER_COLOR = 'rgba(255,255,255,0.08)'
const REDRAW_THROTTLE_MS = 100

// ─── GraphMiniMap ─────────────────────────────────────────────────────────────

/**
 * Canvas-based minimap overlay.
 *
 * Renders all node positions as colored dots, scaled to fit.
 * Draws a viewport rectangle showing the currently visible area.
 * Uses store.subscribe() for imperative redraws with throttling.
 */
export const GraphMiniMap: React.FC = () => {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const rafRef     = useRef<number | null>(null)
  const dirtyRef   = useRef(false)

  // Draw everything to the canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { nodes, viewport } = useGraphEngineStore.getState()

    ctx.clearRect(0, 0, MAP_W, MAP_H)

    // Background
    ctx.fillStyle = BG_COLOR
    ctx.fillRect(0, 0, MAP_W, MAP_H)

    // Gather node positions
    const positions: { x: number; y: number; type: string }[] = []
    for (const node of nodes.values()) {
      if (node.position && node.visible) {
        positions.push({ x: node.position.x, y: node.position.y, type: node.type })
      }
    }

    if (positions.length === 0) return

    // Compute bounding box of all positioned nodes
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    for (const p of positions) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }

    const padding = 10
    const graphW  = Math.max(maxX - minX, 1)
    const graphH  = Math.max(maxY - minY, 1)

    const scaleX = (MAP_W - padding * 2) / graphW
    const scaleY = (MAP_H - padding * 2) / graphH
    const scale  = Math.min(scaleX, scaleY)

    const offX = padding + (MAP_W - padding * 2 - graphW * scale) / 2
    const offY = padding + (MAP_H - padding * 2 - graphH * scale) / 2

    // Draw nodes as colored dots
    for (const p of positions) {
      const sx = offX + (p.x - minX) * scale
      const sy = offY + (p.y - minY) * scale
      const color = getNodeTypeColor(p.type).primary

      ctx.beginPath()
      ctx.arc(sx, sy, NODE_DOT_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }

    // Compute viewport rect in graph-space then map to minimap-space
    const { pan, zoom, width: canvasW, height: canvasH } = viewport
    if (canvasW > 0 && canvasH > 0) {
      // Viewport corners in graph space:
      // graph_x = (screen_x - pan.x) / zoom
      const vpLeft  = (-pan.x) / zoom
      const vpTop   = (-pan.y) / zoom
      const vpRight  = vpLeft + canvasW / zoom
      const vpBottom = vpTop + canvasH / zoom

      const mLeft   = offX + (vpLeft   - minX) * scale
      const mTop    = offY + (vpTop    - minY) * scale
      const mRight  = offX + (vpRight  - minX) * scale
      const mBottom = offY + (vpBottom - minY) * scale

      const mW = mRight  - mLeft
      const mH = mBottom - mTop

      // Viewport rectangle
      ctx.strokeStyle = VIEWPORT_STROKE
      ctx.lineWidth   = 1
      ctx.setLineDash([2, 2])
      ctx.strokeRect(mLeft, mTop, mW, mH)
      ctx.setLineDash([])

      // Viewport fill (very subtle)
      ctx.fillStyle = 'rgba(0,212,255,0.04)'
      ctx.fillRect(mLeft, mTop, mW, mH)
    }
  }, [])

  // Schedule a redraw via RAF — deduplicated
  const scheduleRedraw = useCallback(() => {
    if (dirtyRef.current) return
    dirtyRef.current = true
    rafRef.current = requestAnimationFrame(() => {
      dirtyRef.current = false
      redraw()
    })
  }, [redraw])

  // Initial draw + subscribe to store changes
  useEffect(() => {
    redraw()

    let lastThrottleTs = 0

    const unsub = useGraphEngineStore.subscribe(() => {
      const now = performance.now()
      if (now - lastThrottleTs < REDRAW_THROTTLE_MS) return
      lastThrottleTs = now
      scheduleRedraw()
    })

    return () => {
      unsub()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  // redraw and scheduleRedraw are stable useCallback refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={wrapperStyle}>
      <div style={headerStyle}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#00d4ff', boxShadow: '0 0 4px #00d4ff' }} />
        <span style={headerLabelStyle}>MINIMAP</span>
      </div>
      <canvas
        ref={canvasRef}
        width={MAP_W}
        height={MAP_H}
        style={{ display: 'block' }}
      />
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const wrapperStyle: React.CSSProperties = {
  background:     'rgba(7,9,13,0.92)',
  border:         `1px solid ${BORDER_COLOR}`,
  borderRadius:    6,
  overflow:       'hidden',
  backdropFilter: 'blur(4px)',
  boxShadow:      '0 4px 20px rgba(0,0,0,0.4)',
  pointerEvents:  'none',
}

const headerStyle: React.CSSProperties = {
  display:      'flex',
  alignItems:   'center',
  gap:           6,
  padding:      '5px 8px',
  borderBottom: `1px solid ${BORDER_COLOR}`,
  background:   'rgba(0,0,0,0.3)',
}

const headerLabelStyle: React.CSSProperties = {
  fontFamily:    '"IBM Plex Mono", monospace',
  fontSize:       8,
  color:         '#3a5a6a',
  letterSpacing: '0.14em',
}
