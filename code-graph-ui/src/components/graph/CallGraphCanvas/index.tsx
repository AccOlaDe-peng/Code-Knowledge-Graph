// src/components/graph/CallGraphCanvas/index.tsx

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import cytoscape from 'cytoscape'
import cydagre from 'cytoscape-dagre'
import cyCoseBilkent from 'cytoscape-cose-bilkent'
import type { Core, Position } from 'cytoscape'
import type { GraphNode, GraphEdge } from '../../../types/graph'
import {
  buildCyNode,
  buildCyEdge,
  buildCallGraphStylesheet,
  edgeId,
} from './callGraphStyles'

// Register layout plugins — guard against double-registration
try { cytoscape.use(cydagre) } catch (_) { /* already registered */ }
try { cytoscape.use(cyCoseBilkent) } catch (_) { /* already registered */ }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CallGraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeDegrees: Map<string, { in: number; out: number }>
  highlightedIds?: Set<string>
  dimmedIds?: Set<string>
  /** Edge IDs in format `${src}-[${type}]->${tgt}` */
  focusEdgeIds?: Set<string>
  onNodeClick?: (nodeId: string) => void
  /** Show minimap navigation */
  showMinimap?: boolean
  /** Layout algorithm: LR (left-right), TB (top-bottom), or force (cose-bilkent) */
  layoutAlgo?: 'LR' | 'TB' | 'force'
  /** Unique key for viewport persistence. If provided, viewport state is saved to localStorage. */
  storageKey?: string
}

export interface CallGraphCanvasHandle {
  focusNode(nodeId: string): void
  fitView(): void
  runLayout(): Promise<void>
}

// ─── Layout config ────────────────────────────────────────────────────────────

function getLayoutOptions(algo: 'LR' | 'TB' | 'force') {
  if (algo === 'force') {
    return {
      name: 'cose-bilkent',
      animate: false,
      randomize: true,
    }
  }
  return {
    name: 'dagre',
    rankDir: algo,
    nodeSep: 44,
    rankSep: 90,
    marginx: 24,
    marginy: 24,
    animate: false,
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

const CallGraphCanvas = forwardRef<CallGraphCanvasHandle, CallGraphCanvasProps>(
  (
    {
      nodes,
      edges,
      nodeDegrees,
      highlightedIds = new Set(),
      dimmedIds = new Set(),
      focusEdgeIds = new Set(),
      onNodeClick,
      showMinimap = true,
      layoutAlgo = 'LR',
      storageKey,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const minimapContainerRef = useRef<HTMLDivElement>(null)
    const cyRef = useRef<Core | null>(null)
    const minimapCyRef = useRef<Core | null>(null)
    const saveViewportTimerRef = useRef<number | null>(null)
    // Keep latest callback in a ref to avoid stale closure in Cytoscape listener
    const onNodeClickRef = useRef(onNodeClick)
    useEffect(() => { onNodeClickRef.current = onNodeClick }, [onNodeClick])

    // ── Helper: Save/Load viewport ────────────────────────────────────────────
    const saveViewport = (cy: Core) => {
      if (!storageKey) return
      const state = { pan: cy.pan(), zoom: cy.zoom() }
      try {
        localStorage.setItem(`cg-viewport:${storageKey}`, JSON.stringify(state))
      } catch { /* ignore */ }
    }

    const loadViewport = (cy: Core): boolean => {
      if (!storageKey) return false
      try {
        const saved = localStorage.getItem(`cg-viewport:${storageKey}`)
        if (saved) {
          const { pan, zoom } = JSON.parse(saved)
          cy.viewport({ zoom, pan })
          return true
        }
      } catch { /* ignore */ }
      return false
    }

    // ── Initialise Cytoscape once ──────────────────────────────────────────────
    useEffect(() => {
      if (!containerRef.current) return
      const cy = cytoscape({
        container: containerRef.current,
        style: buildCallGraphStylesheet(),

        // Performance settings
        textureOnViewport: true,
        motionBlur: true,
        motionBlurOpacity: 0.08,
        hideEdgesOnViewport: true,
        boxSelectionEnabled: false,
        wheelSensitivity: 0.2,
        minZoom: 0.05,
        maxZoom: 8,
        pixelRatio: 'auto' as unknown as number,
      })

      cy.on('tap', 'node', (evt) => {
        onNodeClickRef.current?.(evt.target.id())
      })

      // ── Drag performance: hide edges during node drag ──────────────────────
      cy.on('grab', 'node', () => {
        cy.edges().addClass('hidden-during-drag')
      })
      cy.on('free', 'node', () => {
        cy.edges().removeClass('hidden-during-drag')
      })

      // ── Viewport persistence: save to localStorage on pan/zoom ─────────────
      cy.on('pan zoom', () => {
        if (saveViewportTimerRef.current) {
          clearTimeout(saveViewportTimerRef.current)
        }
        saveViewportTimerRef.current = window.setTimeout(() => {
          saveViewport(cy)
        }, 500) // Debounce 500ms
      })

      cyRef.current = cy

      // ── Initialize minimap if enabled ───────────────────────────────────────
      if (showMinimap && minimapContainerRef.current) {
        const minimapCy = cytoscape({
          container: minimapContainerRef.current,
          elements: [],
          style: [
            { selector: 'node', style: { width: 3, height: 3, 'background-color': '#3a5a6a', opacity: 0.6 } },
            { selector: 'edge', style: { display: 'none' } },
          ],
          zoomingEnabled: false,
          panningEnabled: false,
          boxSelectionEnabled: false,
          minZoom: 1,
          maxZoom: 1,
          zoom: 1,
        })
        minimapCyRef.current = minimapCy

        // Click to navigate
        minimapCy.on('tap', (evt) => {
          if (evt.target === minimapCy && evt.position) {
            const pos = evt.position
            const container = containerRef.current
            if (!container) return
            const zoom = cy.zoom()
            const newPan = {
              x: (container.clientWidth / 2) - (pos.x * zoom),
              y: (container.clientHeight / 2) - (pos.y * zoom),
            }
            cy.animate({ pan: newPan, duration: 300, easing: 'ease-in-out-cubic' })
          }
        })
      }

      return () => {
        if (saveViewportTimerRef.current) {
          clearTimeout(saveViewportTimerRef.current)
        }
        minimapCyRef.current?.destroy()
        minimapCyRef.current = null
        cy.destroy()
        cyRef.current = null
      }
    }, [showMinimap, storageKey]) // run once

    // ── Expose imperative handle ───────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      focusNode(nodeId: string) {
        const cy = cyRef.current
        if (!cy) return
        const el = cy.$id(nodeId)
        if (!el.length) return
        cy.animate({
          center: { eles: el },
          zoom:   Math.max(cy.zoom(), 1.2),
          duration: 350,
          easing:   'ease-in-out-cubic',
        })
      },
      fitView() {
        cyRef.current?.fit(undefined, 40)
      },
      runLayout(): Promise<void> {
        return new Promise((resolve) => {
          const cy = cyRef.current
          if (!cy || !cy.nodes().length) { resolve(); return }
          const layout = cy.layout(getLayoutOptions(layoutAlgo) as Parameters<Core['layout']>[0])
          layout.one('layoutstop', () => resolve())
          layout.run()
        })
      },
    }))

    // ── Sync nodes & edges (diff update) ──────────────────────────────────────
    useEffect(() => {
      const cy = cyRef.current
      if (!cy) return

      const newNodeIds = new Set(nodes.map((n) => n.id))
      const newEdgeIds = new Set(edges.map(edgeId))

      const nodesToRemove = cy.nodes().filter((n) => !newNodeIds.has(n.id()))
      const edgesToRemove = cy.edges().filter((e) => !newEdgeIds.has(e.id()))
      const nodesToAdd = nodes.filter((n) => !cy.$id(n.id).length)
      const edgesToAdd = edges.filter((e) => !cy.$id(edgeId(e)).length)

      const changed = nodesToRemove.length || edgesToRemove.length || nodesToAdd.length || edgesToAdd.length

      cy.batch(() => {
        edgesToRemove.remove()
        nodesToRemove.remove()
        nodesToAdd.forEach((n) =>
          cy.add(buildCyNode(n, nodeDegrees.get(n.id) ?? { in: 0, out: 0 })),
        )
        edgesToAdd.forEach((e) => cy.add(buildCyEdge(e)))
      })

      // Always run layout when nodes change or layoutAlgo changes
      if (!changed && cy.nodes().length === 0) return

      // Re-run layout then fit or restore viewport
      const layout = cy.layout(getLayoutOptions(layoutAlgo) as Parameters<Core['layout']>[0])
      layout.one('layoutstop', () => {
        // Try to restore saved viewport, otherwise fit
        const restored = loadViewport(cy)
        if (!restored) {
          cy.fit(undefined, 40)
        }
        // Sync positions to minimap after layout
        const minimapCy = minimapCyRef.current
        if (minimapCy && showMinimap) {
          minimapCy.elements().remove()
          const positions: { data: { id: string }; position: Position }[] = []
          cy.nodes().forEach((n) => {
            positions.push({ data: { id: n.id() }, position: n.position() })
          })
          if (positions.length > 0) {
            minimapCy.add(positions)
            minimapCy.fit(undefined, 10)
          }
        }
      })
      layout.run()
    }, [nodes, edges, nodeDegrees, showMinimap, storageKey])

    // ── Re-run layout when layoutAlgo changes ───────────────────────────────────
    useEffect(() => {
      const cy = cyRef.current
      if (!cy || cy.nodes().length === 0) return

      const layout = cy.layout(getLayoutOptions(layoutAlgo) as Parameters<Core['layout']>[0])
      layout.one('layoutstop', () => {
        cy.fit(undefined, 40)
        // Sync positions to minimap
        const minimapCy = minimapCyRef.current
        if (minimapCy && showMinimap) {
          minimapCy.elements().remove()
          const positions: { data: { id: string }; position: Position }[] = []
          cy.nodes().forEach((n) => {
            positions.push({ data: { id: n.id() }, position: n.position() })
          })
          if (positions.length > 0) {
            minimapCy.add(positions)
            minimapCy.fit(undefined, 10)
          }
        }
      })
      layout.run()
    }, [layoutAlgo, showMinimap])

    // ── Sync highlight / dim / focal-edge classes ──────────────────────────────
    useEffect(() => {
      const cy = cyRef.current
      if (!cy) return
      cy.batch(() => {
        cy.elements().removeClass('highlighted dimmed focal-edge')
        highlightedIds.forEach((id) => cy.$id(id).addClass('highlighted'))
        dimmedIds.forEach((id) => cy.$id(id).addClass('dimmed'))
        focusEdgeIds.forEach((id) => cy.$id(id).addClass('focal-edge'))
      })
    }, [highlightedIds, dimmedIds, focusEdgeIds])

    // ── Render ────────────────────────────────────────────────────────────────
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%', background: '#07090d' }}
        />
        {/* Minimap */}
        {showMinimap && nodes.length > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              right: 12,
              width: 140,
              height: 90,
              background: 'rgba(7,9,13,0.9)',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.06)',
              overflow: 'hidden',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              zIndex: 10,
            }}
          >
            <div
              ref={minimapContainerRef}
              style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
            />
            <div style={{
              position: 'absolute',
              top: 4,
              left: 6,
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 7,
              color: 'rgba(58,90,106,0.8)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              pointerEvents: 'none',
            }}>
              MINIMAP
            </div>
          </div>
        )}
      </div>
    )
  },
)

CallGraphCanvas.displayName = 'CallGraphCanvas'

export default CallGraphCanvas
