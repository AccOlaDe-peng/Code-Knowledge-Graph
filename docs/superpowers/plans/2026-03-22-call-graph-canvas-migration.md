# Call Graph Canvas Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ReactFlow with a Cytoscape.js-based `CallGraphCanvas` component in the CallGraph page to eliminate lag on 2000–10000 node graphs.

**Architecture:** Create two new files — `callGraphStyles.ts` (Cytoscape element builders + stylesheet) and `CallGraphCanvas/index.tsx` (Canvas component with imperative handle) — then rewire `pages/CallGraph/index.tsx` to use the new component instead of ReactFlow. All existing business logic (BFS, degree calc, search, depth slider) stays in the page component unchanged.

**Tech Stack:** Cytoscape.js 3.x, cytoscape-dagre 2.x (already installed), React 19, TypeScript 5.9 (no `enum` — use `const` objects with `as const`)

**Spec:** `docs/superpowers/specs/2026-03-22-call-graph-performance-optimization-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/components/graph/CallGraphCanvas/callGraphStyles.ts` | Cytoscape stylesheet, `buildCyNode`, `buildCyEdge`, `edgeId` helper |
| Create | `src/components/graph/CallGraphCanvas/index.tsx` | `CallGraphCanvas` component + `CallGraphCanvasHandle` ref |
| Modify | `src/pages/CallGraph/index.tsx` | Remove ReactFlow, add `focusEdgeIds` memo, wire `CallGraphCanvas` |

---

## Task 1: Create `callGraphStyles.ts`

**Files:**
- Create: `src/components/graph/CallGraphCanvas/callGraphStyles.ts`

This file defines the Cytoscape stylesheet and element builder functions that match the visual design of the existing `FunctionNode`. It uses `GraphNode` / `GraphEdge` from `src/types/graph.ts` (not `EngineGraphNode`).

- [ ] **Step 1.1: Create the file**

```typescript
// src/components/graph/CallGraphCanvas/callGraphStyles.ts

import type { StylesheetStyle, NodeDefinition, EdgeDefinition } from 'cytoscape'
import type { GraphNode, GraphEdge } from '../../../types/graph'

// ─── Constants ────────────────────────────────────────────────────────────────

export const NODE_W = 200
export const NODE_H = 48
export const LABEL_MAX = 18

// ─── Label truncation (spec: 18 visible chars max) ───────────────────────────

function truncateLabel(label: string): string {
  return label.length > LABEL_MAX ? label.slice(0, LABEL_MAX) + '…' : label
}

// ─── Accent colour per node type ─────────────────────────────────────────────

export function getAccent(type: string): string {
  const t = type.toLowerCase()
  if (t === 'api') return '#00d4ff'
  if (t === 'function') return '#00f084'
  if (t === 'class') return '#b08eff'
  return '#ffc145'
}

// ─── Edge ID (stable, avoids collision for multi-edge node pairs) ─────────────

export function edgeId(e: GraphEdge): string {
  return `${e.source}-[${e.type || 'edge'}]->${e.target}`
}

// ─── Element builders ─────────────────────────────────────────────────────────

export function buildCyNode(
  node: GraphNode,
  degrees: { in: number; out: number },
): NodeDefinition {
  const accent = getAccent(node.type)
  const nameLabel = truncateLabel(node.label)
  // Degree line: shown only if non-zero
  const degParts: string[] = []
  if (degrees.in > 0)  degParts.push(`←${degrees.in}`)
  if (degrees.out > 0) degParts.push(`${degrees.out}→`)
  const degLabel = degParts.join('  ')
  const label = degLabel ? `${nameLabel}\n${degLabel}` : nameLabel

  return {
    data: {
      id:      node.id,
      label,
      accent,
      // Used by background-gradient workaround for left-border effect:
      bg:      '#0a0f16',
      nodeType: node.type,
    },
  }
}

export function buildCyEdge(edge: GraphEdge): EdgeDefinition {
  return {
    data: {
      id:     edgeId(edge),
      source: edge.source,
      target: edge.target,
      type:   edge.type,
    },
  }
}

// ─── Stylesheet ───────────────────────────────────────────────────────────────

export function buildCallGraphStylesheet(): StylesheetStyle[] {
  return [
    // ── Base node ──────────────────────────────────────────────────────────────
    {
      selector: 'node',
      style: {
        // Dimensions
        'width':  NODE_W,
        'height': NODE_H,
        'shape':  'round-rectangle',

        // Background: left-side accent simulated via gradient
        // Cytoscape does not support per-side border color;
        // we use a 3px gradient stripe on the left as the closest approximation.
        'background-color':     '#0a0f16',
        'background-fill':      'linear-gradient',
        'background-gradient-stop-colors': 'data(accent) data(accent) #0a0f16',
        'background-gradient-stop-positions': '0% 1.5% 1.5%',
        'background-gradient-direction': 'to-right',

        // Border (uniform, type-coloured as fallback if gradient not supported)
        'border-width':   1,
        'border-color':   '#1a2535',
        'border-opacity': 1,

        // Label (multi-line: name + degrees)
        'label':           'data(label)',
        'color':           '#8ab4c8',
        'font-size':       11,
        'font-family':     '"IBM Plex Mono", monospace',
        'font-weight':     400,
        'text-valign':     'center',
        'text-halign':     'center',
        'text-wrap':       'wrap',
        'text-max-width':  `${NODE_W - 20}px`,
        'text-overflow-wrap': 'whitespace',
        'white-space-wrap': 'pre',

        // Perf
        'overlay-opacity': 0,

        // Transitions
        'transition-property': 'border-color, border-width, background-color, opacity',
        'transition-duration': '0.12s' as unknown as number,
      },
    },

    // ── Node: selected ─────────────────────────────────────────────────────────
    {
      selector: 'node:selected',
      style: {
        'border-width':   2,
        'border-color':   'data(accent)',
        'color':          'data(accent)',
        'z-index':        10,
      },
    },

    // ── Node: highlighted (search match) ───────────────────────────────────────
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 2,
        'border-color': 'data(accent)',
        'z-index':      9,
      },
    },

    // ── Node: dimmed (not in search results) ───────────────────────────────────
    {
      selector: 'node.dimmed',
      style: {
        'opacity': 0.25,
      },
    },

    // ── Base edge ──────────────────────────────────────────────────────────────
    {
      selector: 'edge',
      style: {
        'width':               1,
        'line-color':          '#1a2d20',
        'target-arrow-color':  '#1a2d20',
        'target-arrow-shape':  'triangle',
        'arrow-scale':         0.8,
        'curve-style':         'bezier',
        'opacity':             0.5,
        'overlay-opacity':     0,
        'transition-property': 'opacity, line-color, width',
        'transition-duration': '0.12s' as unknown as number,
      },
    },

    // ── Edge: focal (connected to focused node) ─────────────────────────────────
    {
      selector: 'edge.focal-edge',
      style: {
        'line-color':         '#00f084',
        'target-arrow-color': '#00f084',
        'width':              2,
        'opacity':            1,
        'z-index':            8,
      },
    },

    // ── Edge: dimmed ───────────────────────────────────────────────────────────
    {
      selector: 'edge.dimmed',
      style: {
        'opacity': 0.1,
      },
    },
  ]
}
```

- [ ] **Step 1.2: Verify TypeScript compiles**

```bash
cd code-graph-ui
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in `callGraphStyles.ts` (ignore pre-existing errors in other files if any).

- [ ] **Step 1.3: Commit**

```bash
git add src/components/graph/CallGraphCanvas/callGraphStyles.ts
git commit -m "feat: add CallGraphCanvas styles and element builders"
```

---

## Task 2: Create `CallGraphCanvas` Component

**Files:**
- Create: `src/components/graph/CallGraphCanvas/index.tsx`

The component wraps a Cytoscape instance. It uses a `forwardRef` to expose an imperative handle. React props drive data; Cytoscape updates happen imperatively inside `useEffect`s, with `cy.batch()` to batch all mutations.

- [ ] **Step 2.1: Create the component**

```typescript
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
```

- [ ] **Step 2.2: Verify TypeScript compiles**

```bash
cd code-graph-ui
npx tsc --noEmit 2>&1 | head -40
```

Expected: no new errors from the two new files.

- [ ] **Step 2.3: Commit**

```bash
git add src/components/graph/CallGraphCanvas/index.tsx
git commit -m "feat: add CallGraphCanvas Cytoscape component"
```

---

## Task 3: Migrate `CallGraph` Page

**Files:**
- Modify: `src/pages/CallGraph/index.tsx`

Replace ReactFlow with `CallGraphCanvas`. Keep all existing state, memos, and handlers. Add `focusEdgeIds` memo. Wire the ref handle for `focusNode` / `fitView`.

- [ ] **Step 3.1: Replace the file contents**

The new page keeps: `getNodeAccent`, `StatPill`, all Zustand hooks, `degreeMap`, `visibleIds` BFS, `typeCounts`, `searchQuery`, `depth`, `focusNodeId`, `panelNode` state. It removes: all ReactFlow imports, `dagre` import, `applyDagreLayout`, `FunctionNode`, `nodeTypes`, `useNodesState`, `useEdgesState`, `useReactFlow`.

New additions: `focusEdgeIds` memo, `canvasRef`, large-graph depth auto-reduction, `largeGraphHint` state.

```typescript
// src/pages/CallGraph/index.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Input, Slider, Button, Tooltip, Spin } from 'antd'
import { SearchOutlined, ReloadOutlined, AimOutlined } from '@ant-design/icons'
import { useGraphStore } from '../../store/graphStore'
import { useRepoStore } from '../../store/repoStore'
import NodeDetailPanel from '../../components/NodeDetailPanel'
import RepoSelector from '../../components/ui/RepoSelector'
import CallGraphCanvas, {
  type CallGraphCanvasHandle,
} from '../../components/graph/CallGraphCanvas'
import type { GraphNode } from '../../types/graph'

// ─── Constants ────────────────────────────────────────────────────────────────

const LARGE_GRAPH_THRESHOLD = 3000
const LARGE_GRAPH_DEFAULT_DEPTH = 2

// ─── Accent colour per node type ──────────────────────────────────────────────

function getNodeAccent(type: string): string {
  const t = type.toLowerCase()
  if (t === 'api') return '#00d4ff'
  if (t === 'function') return '#00f084'
  if (t === 'class') return '#b08eff'
  return '#ffc145'
}

// ─── Stat pill ────────────────────────────────────────────────────────────────

const StatPill: React.FC<{ label: string; value: number; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
    <span
      style={{
        fontFamily: "'IBM Plex Mono'",
        fontSize: 16,
        fontWeight: 700,
        color,
        letterSpacing: '-0.02em',
      }}
    >
      {value.toLocaleString()}
    </span>
    <span
      style={{
        fontFamily: "'IBM Plex Mono'",
        fontSize: 9,
        color: '#3a5a6a',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  </div>
)

// ─── Main component ───────────────────────────────────────────────────────────

const CallGraph: React.FC = () => {
  const { callGraph, loadCallGraph, setSelectedNode } = useGraphStore()
  const { activeRepo } = useRepoStore()
  const canvasRef = useRef<CallGraphCanvasHandle>(null)

  const [searchQuery, setSearchQuery]     = useState('')
  const [depth, setDepth]                 = useState(2)
  const [focusNodeId, setFocusNodeId]     = useState<string | null>(null)
  const [panelNode, setPanelNode]         = useState<GraphNode | null>(null)
  const [largeGraphHint, setLargeGraphHint] = useState(false)

  // Load data when repo changes
  useEffect(() => {
    if (activeRepo?.graphId) {
      loadCallGraph(activeRepo.graphId)
    }
  }, [activeRepo?.graphId])

  const rawData = callGraph.data

  // Auto-reduce depth for large graphs (runs once after data loads)
  useEffect(() => {
    if (!rawData) return
    if (rawData.nodes.length > LARGE_GRAPH_THRESHOLD) {
      setDepth(LARGE_GRAPH_DEFAULT_DEPTH)
      setLargeGraphHint(true)
    }
  }, [rawData])

  // Degree map
  const degreeMap = useMemo(() => {
    if (!rawData) return new Map<string, { in: number; out: number }>()
    const map = new Map<string, { in: number; out: number }>()
    rawData.nodes.forEach((n) => map.set(n.id, { in: 0, out: 0 }))
    rawData.edges.forEach((e) => {
      const src = map.get(e.source)
      const tgt = map.get(e.target)
      if (src) src.out++
      if (tgt) tgt.in++
    })
    return map
  }, [rawData])

  // BFS reachability from focused node
  const visibleIds = useMemo(() => {
    if (!rawData || !focusNodeId) return null
    const visited = new Set<string>()
    const outAdj = new Map<string, string[]>()
    const inAdj  = new Map<string, string[]>()
    rawData.edges.forEach((e) => {
      if (!outAdj.has(e.source)) outAdj.set(e.source, [])
      if (!inAdj.has(e.target))  inAdj.set(e.target,  [])
      outAdj.get(e.source)!.push(e.target)
      inAdj.get(e.target)!.push(e.source)
    })
    const queue: [string, number][] = [[focusNodeId, 0]]
    while (queue.length) {
      const [id, d] = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      if (d < depth) {
        outAdj.get(id)?.forEach((nid) => queue.push([nid, d + 1]))
        inAdj.get(id)?.forEach((nid)  => queue.push([nid, d + 1]))
      }
    }
    return visited
  }, [rawData, focusNodeId, depth])

  // Filtered nodes & edges passed to canvas
  const { filteredNodes, filteredEdges } = useMemo(() => {
    if (!rawData) return { filteredNodes: [], filteredEdges: [] }
    const fNodes = rawData.nodes.filter((n) => !visibleIds || visibleIds.has(n.id))
    const visNodeIds = new Set(fNodes.map((n) => n.id))
    const fEdges = rawData.edges.filter(
      (e) => visNodeIds.has(e.source) && visNodeIds.has(e.target),
    )
    return { filteredNodes: fNodes, filteredEdges: fEdges }
  }, [rawData, visibleIds])

  // Search highlight sets
  const { highlightedIds, dimmedIds } = useMemo(() => {
    if (!searchQuery || !rawData) return { highlightedIds: new Set<string>(), dimmedIds: new Set<string>() }
    const q = searchQuery.toLowerCase()
    const matched = new Set(
      rawData.nodes
        .filter((n) => (n.label ?? '').toLowerCase().includes(q))
        .map((n) => n.id),
    )
    const dimmed = matched.size > 0
      ? new Set(rawData.nodes.filter((n) => !matched.has(n.id)).map((n) => n.id))
      : new Set<string>()
    return { highlightedIds: matched, dimmedIds: dimmed }
  }, [searchQuery, rawData])

  // Focal edges for focused node
  const focusEdgeIds = useMemo(() => {
    if (!focusNodeId || !rawData) return new Set<string>()
    return new Set(
      rawData.edges
        .filter((e) => e.source === focusNodeId || e.target === focusNodeId)
        .map((e) => `${e.source}-[${e.type || 'edge'}]->${e.target}`),
    )
  }, [focusNodeId, rawData])

  // Type counts for legend
  const typeCounts = useMemo(() => {
    if (!rawData) return {} as Record<string, number>
    const counts: Record<string, number> = {}
    rawData.nodes.forEach((n) => {
      const t = n.type.toLowerCase()
      counts[t] = (counts[t] ?? 0) + 1
    })
    return counts
  }, [rawData])

  // Node click handler (toggle focus)
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (focusNodeId === nodeId) {
        setFocusNodeId(null)
        setPanelNode(null)
        setSelectedNode(null)
      } else {
        const orig = rawData?.nodes.find((n) => n.id === nodeId) ?? null
        setFocusNodeId(nodeId)
        setPanelNode(orig)
        setSelectedNode(orig)
        canvasRef.current?.focusNode(nodeId)
      }
    },
    [focusNodeId, rawData],
  )

  // Reset
  const handleReset = () => {
    setFocusNodeId(null)
    setPanelNode(null)
    setSelectedNode(null)
    setSearchQuery('')
    setLargeGraphHint(false)
    canvasRef.current?.fitView()
  }

  // Dismiss large-graph hint when user manually changes depth
  const handleDepthChange = (v: number) => {
    setDepth(v)
    setLargeGraphHint(false)
  }

  const nodeCount = rawData?.nodes.length ?? 0
  const edgeCount = rawData?.edges.length ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#07090d' }}>

      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '10px 16px',
          borderBottom: '1px solid #0d1a24',
          background: 'rgba(7,9,13,0.97)',
          backdropFilter: 'blur(12px)',
          flexShrink: 0,
        }}
      >
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 4 }}>
          <div
            style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#00f084', boxShadow: '0 0 10px #00f084aa',
            }}
          />
          <span
            style={{
              fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 700,
              color: '#00f084', letterSpacing: '0.1em', textTransform: 'uppercase',
            }}
          >
            调用图
          </span>
        </div>

        <RepoSelector showStats={false} width={200} />

        {/* Stats */}
        <div style={{ display: 'flex', gap: 20, marginRight: 'auto' }}>
          <StatPill label="节点" value={nodeCount} color="#00d4ff" />
          <StatPill label="调用" value={edgeCount} color="#00f084" />
        </div>

        {/* Type legend */}
        <div style={{ display: 'flex', gap: 10, marginRight: 8 }}>
          {Object.entries(typeCounts).map(([type, count]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: 1, background: getNodeAccent(type) }} />
              <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: '#3a5a6a', letterSpacing: '0.08em' }}>
                {type.toLowerCase()} ({count})
              </span>
            </div>
          ))}
        </div>

        {/* Search */}
        <Input
          prefix={<SearchOutlined style={{ color: '#2a4a5a', fontSize: 11 }} />}
          placeholder="搜索函数 / 类..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: 200, background: '#080e16', border: '1px solid #1a2535',
            borderRadius: 3, color: '#8ab4c8', fontFamily: "'IBM Plex Mono'", fontSize: 11,
          }}
          allowClear
        />

        {/* Depth */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AimOutlined style={{ color: '#2a4a5a', fontSize: 11 }} />
          <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: '#2a4a5a', letterSpacing: '0.1em' }}>
            深度
          </span>
          <Slider
            min={1} max={6} value={depth} onChange={handleDepthChange}
            style={{ width: 72 }} tooltip={{ formatter: (v) => `${v} 层` }}
          />
          <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12, fontWeight: 700, color: '#00f084', minWidth: 14 }}>
            {depth}
          </span>
        </div>

        <Tooltip title="重置视图">
          <Button
            icon={<ReloadOutlined />} onClick={handleReset} size="small"
            style={{ background: '#080e16', border: '1px solid #1a2535', color: '#2a4a5a' }}
          />
        </Tooltip>
      </div>

      {/* ── Graph area ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>

        {/* Loading overlay */}
        {callGraph.loading && (
          <div
            style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(7,9,13,0.85)', zIndex: 10, gap: 12,
            }}
          >
            <Spin size="large" />
            <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: '#2a4a5a', letterSpacing: '0.12em' }}>
              加载调用图...
            </span>
          </div>
        )}

        {/* No repo selected */}
        {!activeRepo && !callGraph.loading && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, opacity: 0.06, marginBottom: 12 }}>⬡</div>
              <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: '#2a4a5a', letterSpacing: '0.1em' }}>
                请从顶栏选择一个仓库
              </div>
            </div>
          </div>
        )}

        {/* Canvas */}
        {activeRepo && (
          <CallGraphCanvas
            ref={canvasRef}
            nodes={filteredNodes}
            edges={filteredEdges}
            nodeDegrees={degreeMap}
            highlightedIds={highlightedIds}
            dimmedIds={dimmedIds}
            focusEdgeIds={focusEdgeIds}
            onNodeClick={handleNodeClick}
          />
        )}

        {/* Node detail panel */}
        {panelNode && (
          <NodeDetailPanel
            node={panelNode}
            edges={rawData?.edges}
            allNodes={rawData?.nodes}
            onClose={() => {
              setPanelNode(null)
              setFocusNodeId(null)
              setSelectedNode(null)
            }}
          />
        )}
      </div>

      {/* ── Focus hint ───────────────────────────────────────────────────────── */}
      {focusNodeId && (
        <div
          style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,240,132,0.08)', border: '1px solid rgba(0,240,132,0.2)',
            borderRadius: 3, padding: '5px 14px', fontFamily: "'IBM Plex Mono'",
            fontSize: 10, color: '#00f084', pointerEvents: 'none', zIndex: 5,
            letterSpacing: '0.06em', backdropFilter: 'blur(8px)',
          }}
        >
          显示 {depth} 层调用链 · 再次点击节点可重置
        </div>
      )}

      {/* ── Large graph hint ─────────────────────────────────────────────────── */}
      {largeGraphHint && (
        <div
          style={{
            position: 'absolute', bottom: focusNodeId ? 52 : 20, left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,193,69,0.08)', border: '1px solid rgba(255,193,69,0.2)',
            borderRadius: 3, padding: '5px 14px', fontFamily: "'IBM Plex Mono'",
            fontSize: 10, color: '#ffc145', pointerEvents: 'none', zIndex: 5,
            letterSpacing: '0.06em', backdropFilter: 'blur(8px)',
          }}
        >
          当前图谱包含 {nodeCount.toLocaleString()} 个节点，已自动限制深度为 {LARGE_GRAPH_DEFAULT_DEPTH}。可通过滑块手动调整。
        </div>
      )}
    </div>
  )
}

export default CallGraph
```

- [ ] **Step 3.2: Verify TypeScript compiles**

```bash
cd code-graph-ui
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors in the three new/modified files. (Ignore pre-existing errors in unrelated files.)

- [ ] **Step 3.3: Start dev server and smoke-test manually**

```bash
cd code-graph-ui
npm run dev
```

Open http://localhost:5173, navigate to the Call Graph page, select a repo. Verify:
- [ ] Graph renders with Cytoscape (Canvas, not DOM nodes)
- [ ] Nodes show label + degree indicators
- [ ] Clicking a node highlights its neighbourhood
- [ ] Search filters nodes correctly
- [ ] Depth slider triggers re-layout
- [ ] Reset button clears state and fits view
- [ ] No console errors

- [ ] **Step 3.4: Commit**

```bash
git add src/pages/CallGraph/index.tsx
git commit -m "feat: migrate CallGraph page from ReactFlow to CallGraphCanvas (Cytoscape)"
```

---

## Task 4: Cleanup (Optional)

**Files:**
- Check: `src/pages/DataLineage/index.tsx` and other pages for `reactflow` usage

Only remove the `reactflow` package if no other page imports it.

- [ ] **Step 4.1: Check for remaining reactflow usage**

```bash
cd code-graph-ui
grep -r "from 'reactflow'" src/ --include="*.tsx" --include="*.ts"
```

Expected output: if the only match was `CallGraph/index.tsx` and it is now gone, proceed. If other pages still use it, skip the removal.

- [ ] **Step 4.2: Remove reactflow dependency (only if no remaining imports)**

```bash
cd code-graph-ui
npm uninstall reactflow
```

Then verify build still works:

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 4.3: Commit (if reactflow was removed)**

```bash
git add package.json package-lock.json
git commit -m "chore: remove unused reactflow dependency"
```

---

## Verification Checklist

After all tasks complete, verify against the spec:

- [ ] Cytoscape renders in Canvas (right-click canvas → "Save image" option exists in browser, DOM inspector shows a `<canvas>` not hundreds of `<div>` nodes)
- [ ] pan/zoom feels smooth on a large graph (no layout recalculation during gesture)
- [ ] BFS depth filter re-layouts correctly (diff update, not full rebuild)
- [ ] Search highlight/dim applies without page re-render
- [ ] Focus node → focal edges highlighted (static, not animated)
- [ ] MiniMap is removed (not present in the new UI)
- [ ] Large graph (>3000 nodes) shows the depth auto-reduction hint
- [ ] TypeScript compiles with zero new errors
