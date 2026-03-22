// src/graph-engine/components/GraphMinimap/MinimapCanvas.tsx

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import cytoscape from 'cytoscape'
import type { Core, NodeDefinition, Position, StylesheetStyle } from 'cytoscape'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MinimapCanvasProps {
  /** Width of the minimap container */
  width?: number
  /** Height of the minimap container */
  height?: number
}

export interface MinimapCanvasHandle {
  /** Sync node positions from main canvas */
  syncPositions(nodes: Map<string, Position>): void
  /** Update viewport rectangle position/size */
  updateViewportRect(pan: Position, zoom: number, canvasWidth: number, canvasHeight: number): void
}

// ─── Minimap Stylesheet (simplified) ───────────────────────────────────────────

function buildMinimapStylesheet(): StylesheetStyle[] {
  return [
    // Nodes: simple dots
    {
      selector: 'node',
      style: {
        'width':  4,
        'height': 4,
        'background-color': '#3a5a6a',
        'border-width': 0,
        'opacity': 0.6,
      },
    },
    // Edges: hidden for performance
    {
      selector: 'edge',
      style: {
        'display': 'none' as const,
      },
    },
    // Viewport rectangle indicator
    {
      selector: 'node.viewport-indicator',
      style: {
        'width':  1,
        'height': 1,
        'shape':  'rectangle',
        'background-color': 'transparent',
        'border-width': 1.5,
        'border-color': '#00d4ff',
        'border-opacity': 0.9,
      },
    },
  ]
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MinimapCanvas = forwardRef<MinimapCanvasHandle, MinimapCanvasProps>(
  ({ width = 160, height = 100 }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const cyRef = useRef<Core | null>(null)
    const viewportRectRef = useRef<string | null>(null)

    // ── Initialize Cytoscape ──────────────────────────────────────────────────
    useEffect(() => {
      if (!containerRef.current) return

      const cy = cytoscape({
        container: containerRef.current,
        elements: [],
        style: buildMinimapStylesheet(),
        // Disable all interactions
        zoomingEnabled: false,
        userZoomingEnabled: false,
        panningEnabled: false,
        userPanningEnabled: false,
        boxSelectionEnabled: false,
        selectionType: 'single',
        minZoom: 1,
        maxZoom: 1,
        zoom: 1,
      })

      cyRef.current = cy

      return () => {
        cy.destroy()
        cyRef.current = null
      }
    }, [])

    // ── Expose handle ─────────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      syncPositions(nodes: Map<string, Position>) {
        const cy = cyRef.current
        if (!cy) return

        // Remove old nodes
        cy.elements().not('node.viewport-indicator').remove()

        // Add nodes with positions
        const elements: NodeDefinition[] = []
        nodes.forEach((pos, id) => {
          elements.push({
            data: { id },
            position: pos,
          })
        })

        if (elements.length > 0) {
          cy.add(elements)
          cy.fit(undefined, 10)
        }
      },

      updateViewportRect(pan, zoom, canvasWidth, canvasHeight) {
        const cy = cyRef.current
        if (!cy) return

        // Calculate viewport rectangle dimensions in graph coordinates
        const viewportW = canvasWidth / zoom
        const viewportH = canvasHeight / zoom
        const viewportX = -pan.x / zoom + viewportW / 2
        const viewportY = -pan.y / zoom + viewportH / 2

        // Remove old viewport indicator
        if (viewportRectRef.current) {
          cy.$id(viewportRectRef.current).remove()
        }

        // Add new viewport indicator
        const rectId = 'viewport-rect'
        cy.add({
          data: { id: rectId },
          position: { x: viewportX, y: viewportY },
          classes: 'viewport-indicator',
        })
        viewportRectRef.current = rectId

        // Resize the indicator to match viewport size
        const rect = cy.$id(rectId)
        rect.style({
          width: viewportW,
          height: viewportH,
        })
      },
    }))

    // ── Handle click to navigate ──────────────────────────────────────────────
    useEffect(() => {
      const cy = cyRef.current
      if (!cy) return

      const handleClick = (evt: cytoscape.EventObject) => {
        if (evt.target === cy) {
          // Click on background - get position and navigate main canvas
          const pos = evt.position
          if (pos) {
            // Dispatch custom event for main canvas to handle
            window.dispatchEvent(new CustomEvent('minimap:navigate', {
              detail: { x: pos.x, y: pos.y },
            }))
          }
        }
      }

      cy.on('tap', handleClick)
      return () => { cy.off('tap', handleClick) }
    }, [])

    // ── Render ────────────────────────────────────────────────────────────────
    return (
      <div
        ref={containerRef}
        style={{
          width,
          height,
          background: 'rgba(7,9,13,0.9)',
          borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.06)',
          overflow: 'hidden',
          cursor: 'crosshair',
        }}
      />
    )
  },
)

MinimapCanvas.displayName = 'MinimapCanvas'
