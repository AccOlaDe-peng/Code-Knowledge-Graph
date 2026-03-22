// src/pages/CallGraph/index.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Input, Slider, Button, Tooltip, Spin, Select } from 'antd'
import { SearchOutlined, ReloadOutlined, AimOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
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
  const initialFocusSetRef = useRef(false)  // Track if we've set initial focus

  const [searchQuery, setSearchQuery]     = useState('')
  const [depth, setDepth]                 = useState(2)
  const [focusNodeId, setFocusNodeId]     = useState<string | null>(null)
  const [panelNode, setPanelNode]         = useState<GraphNode | null>(null)
  const [largeGraphHint, setLargeGraphHint] = useState(false)
  const [layoutAlgo, setLayoutAlgo]       = useState<'LR' | 'TB' | 'force'>('LR')
  const [searchIndex, setSearchIndex]     = useState(0)

  // Load data when repo changes
  useEffect(() => {
    if (activeRepo?.graphId) {
      initialFocusSetRef.current = false  // Reset for new repo
      loadCallGraph(activeRepo.graphId)
    }
  }, [activeRepo?.graphId])

  const rawData = callGraph.data

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

  // For large graphs, auto-select highest-degree node as focus
  useEffect(() => {
    if (!rawData || !degreeMap.size) return
    if (rawData.nodes.length <= LARGE_GRAPH_THRESHOLD) return
    if (initialFocusSetRef.current) return  // already set

    // Find node with highest total degree (in + out)
    let maxDegree = 0
    let maxNodeId: string | null = null
    degreeMap.forEach((deg, id) => {
      const total = deg.in + deg.out
      if (total > maxDegree) {
        maxDegree = total
        maxNodeId = id
      }
    })

    if (maxNodeId) {
      initialFocusSetRef.current = true
      setDepth(LARGE_GRAPH_DEFAULT_DEPTH)
      setFocusNodeId(maxNodeId)
      setLargeGraphHint(true)
    }
  }, [rawData, degreeMap])

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
  const { highlightedIds, dimmedIds, searchResults } = useMemo(() => {
    if (!searchQuery || !rawData) return { highlightedIds: new Set<string>(), dimmedIds: new Set<string>(), searchResults: [] as string[] }
    const q = searchQuery.toLowerCase()
    const results = rawData.nodes
      .filter((n) => (n.label ?? '').toLowerCase().includes(q))
      .map((n) => n.id)
    const matched = new Set(results)
    const dimmed = matched.size > 0
      ? new Set(rawData.nodes.filter((n) => !matched.has(n.id)).map((n) => n.id))
      : new Set<string>()
    return { highlightedIds: matched, dimmedIds: dimmed, searchResults: results }
  }, [searchQuery, rawData])

  // Reset search index when search query changes
  useEffect(() => {
    setSearchIndex(0)
  }, [searchQuery])

  // Auto-focus first search result
  useEffect(() => {
    if (searchResults.length > 0 && searchIndex < searchResults.length) {
      const targetId = searchResults[searchIndex]
      canvasRef.current?.focusNode(targetId)
    }
  }, [searchResults, searchIndex])

  // Search navigation handlers
  const handleSearchPrev = () => {
    if (searchResults.length === 0) return
    const newIndex = searchIndex > 0 ? searchIndex - 1 : searchResults.length - 1
    setSearchIndex(newIndex)
    canvasRef.current?.focusNode(searchResults[newIndex])
  }

  const handleSearchNext = () => {
    if (searchResults.length === 0) return
    const newIndex = searchIndex < searchResults.length - 1 ? searchIndex + 1 : 0
    setSearchIndex(newIndex)
    canvasRef.current?.focusNode(searchResults[newIndex])
  }

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

        {/* Search with navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Input
            prefix={<SearchOutlined style={{ color: '#2a4a5a', fontSize: 11 }} />}
            placeholder="搜索函数 / 类..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: 180, background: '#080e16', border: '1px solid #1a2535',
              borderRadius: 3, color: '#8ab4c8', fontFamily: "'IBM Plex Mono'", fontSize: 11,
            }}
            allowClear
          />
          {searchResults.length > 0 && (
            <>
              <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: '#3a5a6a', minWidth: 40 }}>
                {searchIndex + 1}/{searchResults.length}
              </span>
              <Button
                icon={<LeftOutlined />} size="small" onClick={handleSearchPrev}
                style={{ background: '#080e16', border: '1px solid #1a2535', color: '#3a5a6a', padding: '0 6px' }}
              />
              <Button
                icon={<RightOutlined />} size="small" onClick={handleSearchNext}
                style={{ background: '#080e16', border: '1px solid #1a2535', color: '#3a5a6a', padding: '0 6px' }}
              />
            </>
          )}
        </div>

        {/* Layout selector */}
        <Select
          value={layoutAlgo}
          onChange={setLayoutAlgo}
          size="small"
          style={{ width: 80 }}
          options={[
            { value: 'LR', label: 'LR' },
            { value: 'TB', label: 'TB' },
            { value: 'force', label: 'Force' },
          ]}
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
              <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: '#2a5a6a', letterSpacing: '0.1em' }}>
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
            layoutAlgo={layoutAlgo}
            storageKey={activeRepo.graphId}
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
      {largeGraphHint && focusNodeId && (
        <div
          style={{
            position: 'absolute', bottom: 52, left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,193,69,0.08)', border: '1px solid rgba(255,193,69,0.2)',
            borderRadius: 3, padding: '5px 14px', fontFamily: "'IBM Plex Mono'",
            fontSize: 10, color: '#ffc145', pointerEvents: 'none', zIndex: 5,
            letterSpacing: '0.06em', backdropFilter: 'blur(8px)',
          }}
        >
          大图谱（{nodeCount.toLocaleString()} 节点），已自动聚焦核心节点，显示 {depth} 层调用链。
        </div>
      )}
    </div>
  )
}

export default CallGraph
