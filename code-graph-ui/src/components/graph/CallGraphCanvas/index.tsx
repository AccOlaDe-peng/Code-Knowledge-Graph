// src/components/graph/CallGraphCanvas/index.tsx

import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import cytoscape from 'cytoscape'
import cydagre from 'cytoscape-dagre'
import type { Core } from 'cytoscape'
import type { GraphNode, GraphEdge } from '../../../types/graph'
import {
  buildCyNode,
  buildCyEdge,
  buildCallGraphStylesheet,
  edgeId,
} from './callGraphStyles'

// Register dagre layout plugin — guard against double-registration
// (GraphCanvas, GraphViewer, and other components also call cytoscape.use at
//  module scope; Cytoscape throws if the same plugin is registered twice)
try { cytoscape.use(cydagre) } catch (_) { /* already registered */ }

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
}

export interface CallGraphCanvasHandle {
  focusNode(nodeId: string): void
  fitView(): void
  runLayout(): Promise<void>
}

// ─── Layout config ────────────────────────────────────────────────────────────

const LAYOUT_OPTIONS = {
  name: 'dagre',
  rankDir: 'LR',
  nodeSep: 44,
  rankSep: 90,
  marginx: 24,
  marginy: 24,
  animate: false,
} as const

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
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const cyRef = useRef<Core | null>(null)
    // Keep latest callback in a ref to avoid stale closure in Cytoscape listener
    const onNodeClickRef = useRef(onNodeClick)
    useEffect(() => { onNodeClickRef.current = onNodeClick }, [onNodeClick])

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

      cyRef.current = cy
      return () => { cy.destroy(); cyRef.current = null }
    }, []) // run once

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
          const layout = cy.layout(LAYOUT_OPTIONS as Parameters<Core['layout']>[0])
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

      if (!changed) return

      // Re-run layout then fit
      const layout = cy.layout(LAYOUT_OPTIONS as Parameters<Core['layout']>[0])
      layout.one('layoutstop', () => {
        cy.fit(undefined, 40)
      })
      layout.run()
    }, [nodes, edges, nodeDegrees])

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
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', background: '#07090d' }}
      />
    )
  },
)

CallGraphCanvas.displayName = 'CallGraphCanvas'

export default CallGraphCanvas
