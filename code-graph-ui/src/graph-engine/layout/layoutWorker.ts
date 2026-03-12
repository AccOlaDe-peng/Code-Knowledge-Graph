/// <reference lib="webworker" />
/**
 * layoutWorker.ts
 *
 * This file runs inside a Web Worker. It has NO access to the DOM,
 * React, Zustand, or any browser-only API. Only ESM imports of
 * pure-computation packages are allowed here.
 *
 * Vite bundles this file separately when imported with `?worker`.
 * All `import` statements here are resolved at build time by Vite.
 */

import * as dagre from 'dagre'
import type {
  LayoutRequest,
  LayoutResponse,
  LayoutNodeInput,
  LayoutEdgeInput,
  DagreConfig,
  NodePosition,
  EdgePath,
  LayoutMetrics,
} from './types'

// ─── SVG Path Builder ─────────────────────────────────────────────────────────

/**
 * Convert dagre waypoints into a smooth SVG cubic bezier path string.
 *
 * Dagre returns control points including source/target port coordinates.
 * We render them as quadratic bezier splines through each waypoint,
 * which produces natural-looking curved edges without overshoot.
 *
 * Algorithm: for consecutive waypoints A → B → C, render a Q curve
 * from A to the midpoint(B,C) with B as the control point.
 * The final segment is a straight line to the last point.
 */
function buildSvgPath(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  }

  const p = points
  let d = `M ${p[0].x} ${p[0].y}`

  for (let i = 1; i < p.length - 1; i++) {
    // Control point: current waypoint
    // End point: midpoint between current and next waypoint
    const mx = (p[i].x + p[i + 1].x) / 2
    const my = (p[i].y + p[i + 1].y) / 2
    d += ` Q ${p[i].x} ${p[i].y} ${mx} ${my}`
  }

  // Final straight segment to the target port
  const last = p[p.length - 1]
  d += ` L ${last.x} ${last.y}`

  return d
}

// ─── Core Layout Computation ──────────────────────────────────────────────────

/**
 * Run the dagre layout algorithm on the supplied nodes and edges.
 *
 * Dagre assigns center-point (x, y) to every node and an ordered list
 * of waypoints to every edge. The computation is fully synchronous.
 *
 * Fixed nodes (node.fixed = true) are added to the dagre graph for
 * routing purposes but their positions are overridden after layout with
 * the caller-supplied coordinates. This preserves connectivity routing
 * while preventing already-positioned nodes from moving.
 */
function computeLayout(
  nodes:  LayoutNodeInput[],
  edges:  LayoutEdgeInput[],
  config: DagreConfig,
): { positions: NodePosition[]; edgePaths: EdgePath[]; metrics: LayoutMetrics } {
  const t0 = Date.now()

  // Build dagre graph
  const g = new dagre.graphlib.Graph({ multigraph: true })

  g.setGraph({
    rankdir: config.rankdir,
    ranksep: config.ranksep,
    nodesep: config.nodesep,
    edgesep: config.edgesep,
    marginx: config.marginx,
    marginy: config.marginy,
    ...(config.align ? { align: config.align } : {}),
  })

  // dagre requires a default edge label function
  g.setDefaultEdgeLabel(() => ({}))

  // ── Add nodes ──────────────────────────────────────────────────────────────
  const nodeSet = new Set<string>()
  for (const node of nodes) {
    g.setNode(node.id, { width: node.width, height: node.height })
    nodeSet.add(node.id)
  }

  // ── Add edges (only between nodes that exist in the graph) ────────────────
  // Dagre throws if source or target is not a registered node.
  // Track edge → id mapping for result extraction.
  const edgeIdMap = new Map<string, string>()

  for (const edge of edges) {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) continue
    // Multigraph: name is the disambiguator for parallel edges
    const name = edge.id
    g.setEdge(edge.source, edge.target, { weight: edge.weight ?? 1 }, name)
    edgeIdMap.set(name, edge.id)
  }

  // ── Run layout ────────────────────────────────────────────────────────────
  dagre.layout(g)

  const duration = Date.now() - t0

  // ── Extract node positions ─────────────────────────────────────────────────
  const positions: NodePosition[] = []

  for (const nodeId of g.nodes()) {
    const dagreNode = g.node(nodeId)
    const input = nodes.find(n => n.id === nodeId)

    if (!dagreNode || !input) continue

    // Honor fixed positions: override dagre's computed coordinates
    const x = input.fixed && input.x !== undefined ? input.x : dagreNode.x
    const y = input.fixed && input.y !== undefined ? input.y : dagreNode.y

    positions.push({
      id:     nodeId,
      x,
      y,
      width:  input.width,
      height: input.height,
    })
  }

  // ── Extract edge paths ─────────────────────────────────────────────────────
  const edgePaths: EdgePath[] = []

  for (const edgeObj of g.edges()) {
    const dagreEdge = g.edge(edgeObj)
    const edgeId    = edgeIdMap.get(edgeObj.name ?? '')

    if (!edgeId || !dagreEdge) continue

    const rawPoints: Array<{ x: number; y: number }> = dagreEdge.points ?? []

    // Ensure we have at least source and target fallback points
    const points: Array<{ x: number; y: number }> =
      rawPoints.length > 0
        ? rawPoints
        : [
            g.node(edgeObj.v)
              ? { x: g.node(edgeObj.v).x, y: g.node(edgeObj.v).y }
              : { x: 0, y: 0 },
            g.node(edgeObj.w)
              ? { x: g.node(edgeObj.w).x, y: g.node(edgeObj.w).y }
              : { x: 0, y: 0 },
          ]

    edgePaths.push({
      id:      edgeId,
      source:  edgeObj.v,
      target:  edgeObj.w,
      points,
      svgPath: buildSvgPath(points),
    })
  }

  // ── Graph bounding box from dagre ─────────────────────────────────────────
  const graphData = g.graph() as { width?: number; height?: number }

  return {
    positions,
    edgePaths,
    metrics: {
      graphWidth:  graphData.width  ?? 0,
      graphHeight: graphData.height ?? 0,
      duration,
      nodeCount:   positions.length,
      edgeCount:   edgePaths.length,
    },
  }
}

// ─── Worker Message Handler ───────────────────────────────────────────────────

self.addEventListener('message', (event: MessageEvent<LayoutRequest>) => {
  const req = event.data

  if (req.type !== 'COMPUTE_LAYOUT') return

  try {
    const { positions, edgePaths, metrics } = computeLayout(
      req.nodes,
      req.edges,
      req.config,
    )

    const response: LayoutResponse = {
      type:      'LAYOUT_RESULT',
      requestId: req.requestId,
      positions,
      edgePaths,
      metrics,
    }

    // Transfer is not applicable here (no ArrayBuffer/SharedArrayBuffer),
    // so we post the structured-clone copy directly.
    self.postMessage(response)
  } catch (err) {
    const error: LayoutResponse = {
      type:      'LAYOUT_ERROR',
      requestId: req.requestId,
      error:     err instanceof Error ? err.message : String(err),
    }
    self.postMessage(error)
  }
})
