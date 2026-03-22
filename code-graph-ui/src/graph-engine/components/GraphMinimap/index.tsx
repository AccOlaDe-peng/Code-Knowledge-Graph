// src/graph-engine/components/GraphMinimap/index.tsx

import React, { useEffect, useRef, useCallback } from 'react'
import { MinimapCanvas, type MinimapCanvasHandle } from './MinimapCanvas'
import { useGraphEngineStore } from '../../store'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GraphMinimapProps {
  /** Width of the minimap */
  width?: number
  /** Height of the minimap */
  height?: number
  /** Whether to show minimap (can be toggled) */
  visible?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * GraphMinimap
 *
 * A minimap component that syncs with the main GraphCanvas.
 * Shows a simplified view of the entire graph and a viewport rectangle
 * indicating the current visible area.
 *
 * Features:
 * - Real-time position sync from main canvas
 * - Click to navigate to a location
 * - Viewport rectangle shows current view
 */
export const GraphMinimap: React.FC<GraphMinimapProps> = ({
  width = 160,
  height = 100,
  visible = true,
}) => {
  const minimapRef = useRef<MinimapCanvasHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Store state
  const nodes = useGraphEngineStore(s => s.nodes)
  const viewport = useGraphEngineStore(s => s.viewport)

  // ── Sync node positions to minimap ─────────────────────────────────────────
  useEffect(() => {
    const minimap = minimapRef.current
    if (!minimap || !visible) return

    // Extract positions from nodes
    const positions = new Map<string, { x: number; y: number }>()
    nodes.forEach((node, id) => {
      if (node.position) {
        positions.set(id, node.position)
      }
    })

    if (positions.size > 0) {
      minimap.syncPositions(positions)
    }
  }, [nodes, visible])

  // ── Update viewport rectangle ───────────────────────────────────────────────
  const updateViewport = useCallback(() => {
    const minimap = minimapRef.current
    const container = containerRef.current
    if (!minimap || !container || !visible) return

    const { pan, zoom } = viewport
    const canvasWidth = container.clientWidth
    const canvasHeight = container.clientHeight

    minimap.updateViewportRect(pan, zoom, canvasWidth, canvasHeight)
  }, [viewport, visible])

  useEffect(() => {
    updateViewport()
  }, [updateViewport])

  // ── Handle minimap navigation clicks ────────────────────────────────────────
  useEffect(() => {
    const handleNavigate = (e: CustomEvent<{ x: number; y: number }>) => {
      const { x, y } = e.detail
      // Dispatch to main canvas
      window.dispatchEvent(new CustomEvent('minimap:pan-to', {
        detail: { x, y },
      }))
    }

    window.addEventListener('minimap:navigate', handleNavigate as EventListener)
    return () => {
      window.removeEventListener('minimap:navigate', handleNavigate as EventListener)
    }
  }, [])

  if (!visible) return null

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        zIndex: 15,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      }}
    >
      <MinimapCanvas
        ref={minimapRef}
        width={width}
        height={height}
      />
      {/* Label */}
      <div style={{
        position: 'absolute',
        top: 4,
        left: 6,
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 8,
        color: 'rgba(58,90,106,0.8)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        pointerEvents: 'none',
      }}>
        MINIMAP
      </div>
    </div>
  )
}

export default GraphMinimap
