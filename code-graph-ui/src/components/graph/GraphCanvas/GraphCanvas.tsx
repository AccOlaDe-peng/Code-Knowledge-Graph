import React, { useEffect, useRef, useCallback } from 'react'
import cytoscape from 'cytoscape'
import cydagre from 'cytoscape-dagre'
import type { Core } from 'cytoscape'

import {
  useGraphEngineStore,
  selectIsLoading,
  selectZoom,
  selectNodeCount,
} from '../../../graph-engine/store'
import type { GraphEngineState } from '../../../graph-engine/store'
import type { EngineGraphNode, EngineGraphEdge } from '../../../graph-engine/types'

import { buildCyStylesheet, buildCyNode, buildCyEdge } from './cyStyles'

// Register Cytoscape layout plugin (idempotent — safe to call multiple times)
cytoscape.use(cydagre)

// ─── CyHandle ─────────────────────────────────────────────────────────────────

/**
 * Imperative handle exposed by GraphCanvas via forwardRef.
 * Use this ref to drive the Cytoscape instance directly from a parent component.
 */
export type CyHandle = {
  /** Add nodes and edges to the canvas (incremental — does not clear first). */
  addElements(nodes: EngineGraphNode[], edges: EngineGraphEdge[]): void
  /** Remove all elements from the canvas. */
  clear(): void
  /**
   * Run a layout algorithm on the canvas.
   * @param algo            Algorithm name. Default: 'dagre'.
   * @param incrementalOnly If true, lock existing nodes so only newly-added ones
   *                        get repositioned. Default: false.
   */
  runLayout(algo?: 'dagre' | 'cose-bilkent', incrementalOnly?: boolean): Promise<void>
  /** Fit the viewport to show all elements, with optional padding (px). */
  fit(padding?: number): void
  /** Animate the viewport to center on a specific node. */
  focusNode(nodeId: string): void
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type GraphCanvasProps = {
  /** CSS height of the canvas container. Default: '100%'. */
  height?:            string | number
  /** Called when a node is clicked. */
  onNodeClick?:       (node: EngineGraphNode) => void
  /** Called when a node is hovered (null = mouse left all nodes). */
  onNodeHover?:       (node: EngineGraphNode | null) => void
  /** Called when the background is clicked (deselect). */
  onBackgroundClick?: () => void
  /** Show the stats bar (node count, zoom). Default: true. */
  showStats?:         boolean
  /** Show zoom in/out/fit controls. Default: true. */
  showControls?:      boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ZOOM_MIN = 0.05
const ZOOM_MAX = 8.0
const ZOOM_STEP = 1.3

// ─── Cytoscape Element Sync ───────────────────────────────────────────────────
// These functions are module-level (not inside the component) for performance —
// they avoid being recreated on every render and can be called synchronously
// from the Zustand subscriber without capturing stale closures.

/**
 * Update Cytoscape selection state to match the store's selectedNodeId.
 */
function syncSelectionToCy(
  cy:       Core,
  currId:   string | null,
  prevId:   string | null,
): void {
  cy.startBatch()

  if (prevId) cy.$id(prevId).unselect()
  if (currId) cy.$id(currId).select()

  cy.endBatch()
}

/**
 * Highlight the neighbourhood of the given node and fade everything else.
 * Pass null to clear all highlight/fade classes.
 */
function applyNeighbourhoodHighlight(cy: Core, nodeId: string | null): void {
  cy.startBatch()
  cy.elements().removeClass('highlighted faded hovered')

  if (nodeId) {
    const node = cy.$id(nodeId)
    const hood = node.closedNeighborhood()
    hood.addClass('highlighted')
    cy.elements().not(hood).addClass('faded')
  }

  cy.endBatch()
}

// ─── GraphCanvas ──────────────────────────────────────────────────────────────

/**
 * GraphCanvas
 *
 * The production Cytoscape renderer for the GraphEngine.
 *
 * Architecture:
 *  - Cytoscape is initialized ONCE and its lifecycle is tied to the effect.
 *  - All store → Cytoscape syncs happen via `useGraphEngineStore.subscribe()`
 *    (imperative, no React re-renders for graph data changes).
 *  - React state is used ONLY for the UI overlay (loading, stats, controls).
 *  - Cytoscape events → store actions (viewport, selection, hover).
 *
 * Performance flags:
 *  - textureOnViewport: true  → canvas renders as texture during pan/zoom
 *  - motionBlur:        true  → smooths fast motion
 *  - wheelSensitivity:  0.2   → gentler scroll zoom
 *  - boxSelectionEnabled: false → removes selection overhead
 */
export const GraphCanvas = React.forwardRef<CyHandle, GraphCanvasProps>(function GraphCanvas({
  height          = '100%',
  onNodeClick,
  onNodeHover,
  onBackgroundClick,
  showStats    = true,
  showControls = true,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef        = useRef<Core | null>(null)

  // ── React state for UI overlays only ──────────────────────────────────────
  // These subscriptions ARE reactive because they drive rendered HTML.
  const isLoading       = useGraphEngineStore(selectIsLoading)
  const loadProgress    = useGraphEngineStore(s => s.loading.progress)
  const zoom            = useGraphEngineStore(selectZoom)
  const totalCount      = useGraphEngineStore(selectNodeCount)

  // ── Zoom controls ─────────────────────────────────────────────────────────

  const handleZoomIn = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    const container = containerRef.current
    cy.zoom({
      level:            Math.min(cy.zoom() * ZOOM_STEP, ZOOM_MAX),
      renderedPosition: container
        ? { x: container.clientWidth / 2, y: container.clientHeight / 2 }
        : cy.pan(),
    })
  }, [])

  const handleZoomOut = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    const container = containerRef.current
    cy.zoom({
      level:            Math.max(cy.zoom() / ZOOM_STEP, ZOOM_MIN),
      renderedPosition: container
        ? { x: container.clientWidth / 2, y: container.clientHeight / 2 }
        : cy.pan(),
    })
  }, [])

  const handleFit = useCallback(() => {
    cyRef.current?.fit(undefined, 40)
  }, [])

  // ── Expose CyHandle to parent via forwardRef ───────────────────────────────
  // cyRef is a stable object — deps array [] is correct.
  React.useImperativeHandle(ref, () => ({
    addElements(nodes: EngineGraphNode[], edges: EngineGraphEdge[]): void {
      const inst = cyRef.current
      if (!inst) return
      inst.startBatch()
      for (const node of nodes) {
        if (!inst.$id(node.id).length) {
          // Add node and mark it as 'new-node' so runLayout(incrementalOnly=true)
          // can identify it as a candidate for repositioning.
          inst.add(buildCyNode(node)).addClass('new-node')
        }
      }
      for (const edge of edges) {
        if (!inst.$id(edge.id).length &&
            inst.$id(edge.source).length &&
            inst.$id(edge.target).length) {
          inst.add(buildCyEdge(edge))
        }
      }
      inst.endBatch()
    },

    clear(): void {
      cyRef.current?.elements().remove()
    },

    runLayout(algo: 'dagre' | 'cose-bilkent' = 'dagre', incrementalOnly = false): Promise<void> {
      const inst = cyRef.current
      if (!inst) return Promise.resolve()
      return new Promise<void>((resolve) => {
        if (incrementalOnly) {
          // Lock existing nodes; only newly-added (class 'new-node') get repositioned
          inst.nodes().not('.new-node').lock()
        }
        const layout = inst.layout({
          name: algo,
          // @ts-expect-error cytoscape-dagre options
          rankDir:           'TB',
          nodeSep:           60,
          rankSep:           80,
          padding:           40,
          animate:           true,
          animationDuration: 400,
          stop: () => {
            if (incrementalOnly) {
              inst.nodes().unlock()
              inst.nodes().removeClass('new-node')
            }
            resolve()
          },
        })
        layout.run()
      })
    },

    fit(padding = 40): void {
      cyRef.current?.fit(undefined, padding)
    },

    focusNode(nodeId: string): void {
      const inst = cyRef.current
      if (!inst) return
      const node = inst.$id(nodeId)
      if (!node.length) return
      inst.animate({
        center:   { eles: node },
        zoom:     Math.max(inst.zoom(), 1.2),
        duration: 400,
        easing:   'ease-in-out-cubic',
      })
    },
  }), []) // cyRef object is stable — no deps needed

  // ── Cytoscape initialization ───────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // ── Create cy instance ──────────────────────────────────────────────────
    const cy = cytoscape({
      container,
      elements: [],
      style:    buildCyStylesheet(),

      // ── Initial viewport ────────────────────────────────────────────────
      zoom:    1,
      minZoom: ZOOM_MIN,
      maxZoom: ZOOM_MAX,

      // ── Performance flags ────────────────────────────────────────────────
      // Render elements as a flat texture while the user is panning/zooming.
      // Dramatically reduces GPU load for large graphs during interaction.
      textureOnViewport:    true,
      // Blend previous frame with current during motion for a smoother feel.
      motionBlur:           true,
      motionBlurOpacity:    0.08,
      // Slow down mouse wheel zoom — default (1.0) is too aggressive.
      wheelSensitivity:     0.2,
      // Disable box selection: not needed and adds per-frame rect-hit tests.
      boxSelectionEnabled:  false,
      // Let Cytoscape pick the best pixel ratio for the device.
      pixelRatio:           'auto',
    })

    cyRef.current = cy

    // ── Store subscriber: imperative sync (no React re-renders) ─────────────
    // Runs outside React's rendering cycle — zero overhead for 100k nodes.
    const unsubscribeStore = useGraphEngineStore.subscribe(
      (state: GraphEngineState, prev: GraphEngineState) => {
        if (!cyRef.current || cyRef.current.destroyed()) return
        const inst = cyRef.current

        // Selection: highlight neighbourhood, dim everything else
        if (state.selectedNodeId !== prev.selectedNodeId) {
          syncSelectionToCy(inst, state.selectedNodeId, prev.selectedNodeId)
          applyNeighbourhoodHighlight(inst, state.selectedNodeId)
        }

        // Search: add 'highlighted' class to search-result nodes
        if (state.filters.highlightedIds !== prev.filters.highlightedIds) {
          inst.startBatch()
          inst.nodes().removeClass('highlighted')
          state.filters.highlightedIds.forEach(id => {
            inst.$id(id).addClass('highlighted')
          })
          inst.endBatch()
        }
      },
    )

    // ── Node: tap (click) ────────────────────────────────────────────────────
    cy.on('tap', 'node', (evt) => {
      const cyNode  = evt.target
      const nodeId: string = cyNode.id()
      const store   = useGraphEngineStore.getState()
      const node    = store.nodes.get(nodeId)
      if (!node) return

      store.setSelectedNode(nodeId)
      onNodeClick?.(node)
    })

    // ── Background: tap (deselect) ────────────────────────────────────────────
    cy.on('tap', (evt) => {
      if (evt.target !== cy) return
      useGraphEngineStore.getState().setSelectedNode(null)
      applyNeighbourhoodHighlight(cy, null)
      onBackgroundClick?.()
    })

    // ── Node: mouseover (hover) ───────────────────────────────────────────────
    cy.on('mouseover', 'node', (evt) => {
      const cyNode  = evt.target
      const nodeId: string = cyNode.id()
      const node    = useGraphEngineStore.getState().nodes.get(nodeId)
      if (!node) return

      cy.startBatch()
      cyNode.addClass('hovered')
      // Dim unrelated nodes on hover (lighter than click-select fading)
      cy.elements()
        .not(cyNode.closedNeighborhood())
        .addClass('faded')
      cy.endBatch()

      container.style.cursor = 'pointer'
      onNodeHover?.(node)
    })

    // ── Node: mouseout ────────────────────────────────────────────────────────
    cy.on('mouseout', 'node', () => {
      // Only restore if there's no selected node holding the highlight
      const selectedId = useGraphEngineStore.getState().selectedNodeId
      if (!selectedId) {
        cy.startBatch()
        cy.elements().removeClass('hovered faded')
        cy.endBatch()
      }
      container.style.cursor = 'default'
      onNodeHover?.(null)
    })

    // ── Zoom: sync level to store (for stats overlay) ─────────────────────────
    cy.on('zoom', () => {
      useGraphEngineStore.getState().updateViewport(cy.pan(), cy.zoom())
    })

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      unsubscribeStore()
      cy.destroy()
      cyRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // empty deps: init once; callbacks via refs are stable

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position:     'relative',
      width:        '100%',
      height,
      background:   'var(--s-void, #07090d)',
      borderRadius: 'var(--radius-m, 6px)',
      overflow:     'hidden',
      border:       '1px solid var(--b-faint, rgba(255,255,255,0.06))',
    }}>

      {/* ── Cytoscape canvas mount point ─────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        aria-label="Graph canvas"
      />

      {/* ── Loading overlay ───────────────────────────────────────────────── */}
      {isLoading && (
        <div style={{
          position:       'absolute',
          inset:           0,
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          pointerEvents:  'none',
          zIndex:          20,
          background:     'rgba(7,9,13,0.55)',
          backdropFilter: 'blur(2px)',
        }}>
          <LoadingIndicator
            loaded={loadProgress.loaded}
            total={loadProgress.total}
          />
        </div>
      )}

      {/* ── Stats bar (top-left) ──────────────────────────────────────────── */}
      {showStats && (
        <div style={{
          position:       'absolute',
          top:             10,
          left:            10,
          display:        'flex',
          alignItems:     'center',
          gap:             6,
          zIndex:          10,
          pointerEvents:  'none',
        }}>
          <StatsBadge
            visibleCount={totalCount}
            totalCount={totalCount}
            zoom={zoom}
          />
        </div>
      )}

      {/* ── Zoom controls (top-right) ─────────────────────────────────────── */}
      {showControls && (
        <div style={{
          position:      'absolute',
          top:            10,
          right:          10,
          display:       'flex',
          flexDirection: 'column',
          gap:            4,
          zIndex:         10,
        }}>
          <IconButton label="+" title="Zoom in"  onClick={handleZoomIn}  />
          <IconButton label="−" title="Zoom out" onClick={handleZoomOut} />
          <IconButton label="⊡" title="Fit view" onClick={handleFit}     />
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {totalCount === 0 && !isLoading && (
        <EmptyState />
      )}
    </div>
  )
})

// ─── Sub-components ───────────────────────────────────────────────────────────

const LoadingIndicator: React.FC<{ loaded: number; total: number }> = ({ loaded, total }) => {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0

  return (
    <div style={{ textAlign: 'center' }}>
      {/* Animated spinner ring */}
      <div style={{
        width:        40,
        height:       40,
        borderRadius: '50%',
        border:       '2px solid rgba(0,212,255,0.15)',
        borderTop:    '2px solid #00d4ff',
        animation:    'graph-spin 0.8s linear infinite',
        marginBottom:  12,
      }} />
      <div style={{
        fontFamily:    '"IBM Plex Mono", monospace',
        fontSize:       11,
        color:         '#00d4ff',
        letterSpacing: '0.1em',
        marginBottom:   6,
      }}>
        LOADING GRAPH
      </div>
      {total > 0 && (
        <>
          <div style={{ width: 160, height: 2, background: 'rgba(0,212,255,0.15)', borderRadius: 1 }}>
            <div style={{
              width:        `${pct}%`,
              height:       '100%',
              background:   '#00d4ff',
              borderRadius:  1,
              transition:   'width 0.2s',
            }} />
          </div>
          <div style={{
            fontFamily:    '"IBM Plex Mono", monospace',
            fontSize:       9,
            color:         'rgba(0,212,255,0.6)',
            letterSpacing: '0.06em',
            marginTop:      5,
          }}>
            {loaded.toLocaleString()} / {total.toLocaleString()} nodes
          </div>
        </>
      )}
      {/* Keyframe animation injected once */}
      <style>{`@keyframes graph-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const StatsBadge: React.FC<{
  visibleCount: number
  totalCount:   number
  zoom:         number
}> = ({ visibleCount, totalCount, zoom }) => (
  <div style={{
    display:        'flex',
    alignItems:     'center',
    gap:             8,
    background:     'rgba(10,13,19,0.82)',
    backdropFilter: 'blur(8px)',
    border:         '1px solid rgba(255,255,255,0.07)',
    borderRadius:    4,
    padding:        '4px 10px',
  }}>
    <StatItem label="visible" value={visibleCount} color="#00d4ff" />
    <Dot />
    <StatItem label="total"   value={totalCount}   color="#9ba8c8" />
    <Dot />
    <StatItem label="zoom"    value={`${Math.round(zoom * 100)}%`} color="#6b7a9d" />
  </div>
)

const StatItem: React.FC<{ label: string; value: number | string; color: string }> = ({
  label, value, color,
}) => (
  <span style={{
    fontFamily:    '"IBM Plex Mono", monospace',
    fontSize:       9,
    color:         'rgba(155,168,200,0.7)',
    letterSpacing: '0.06em',
  }}>
    <span style={{ color, fontWeight: 600 }}>{value.toLocaleString()}</span>
    {' '}{label}
  </span>
)

const Dot = () => (
  <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 9 }}>·</span>
)

const iconBtnStyle: React.CSSProperties = {
  width:          28,
  height:         28,
  display:       'flex',
  alignItems:    'center',
  justifyContent: 'center',
  background:     'rgba(10,13,19,0.82)',
  backdropFilter: 'blur(8px)',
  border:         '1px solid rgba(255,255,255,0.07)',
  borderRadius:    4,
  color:          'rgba(155,168,200,0.8)',
  fontFamily:     '"IBM Plex Mono", monospace',
  fontSize:        14,
  cursor:         'pointer',
  transition:     'all 0.1s',
  userSelect:     'none',
}

const IconButton: React.FC<{
  label:   string
  title:   string
  onClick: () => void
}> = ({ label, title, onClick }) => (
  <button
    onClick={onClick}
    title={title}
    style={iconBtnStyle}
    onMouseEnter={e => {
      const el = e.currentTarget
      el.style.color        = '#00d4ff'
      el.style.borderColor  = 'rgba(0,212,255,0.35)'
    }}
    onMouseLeave={e => {
      const el = e.currentTarget
      el.style.color        = 'rgba(155,168,200,0.8)'
      el.style.borderColor  = 'rgba(255,255,255,0.07)'
    }}
  >
    {label}
  </button>
)

const EmptyState = () => (
  <div style={{
    position:       'absolute',
    inset:           0,
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    zIndex:          5,
    pointerEvents:  'none',
  }}>
    <div style={{ fontSize: 36, opacity: 0.1, marginBottom: 10 }}>◈</div>
    <div style={{
      fontFamily:    '"IBM Plex Mono", monospace',
      fontSize:       11,
      color:         'rgba(107,122,157,0.7)',
      letterSpacing: '0.12em',
    }}>
      NO GRAPH DATA
    </div>
  </div>
)
