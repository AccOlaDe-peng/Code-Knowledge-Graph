import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import { Input, Slider, Button, Tooltip, Empty, Spin, Badge } from 'antd'
import { SearchOutlined, ReloadOutlined, AimOutlined } from '@ant-design/icons'
import { useGraphStore } from '../../store/graphStore'
import { useRepoStore } from '../../store/repoStore'
import NodeDetailPanel from '../../components/NodeDetailPanel'
import type { GraphNode } from '../../types/graph'

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeData = {
  label:         string
  nodeType:      string
  inDegree:      number
  outDegree:     number
  isHighlighted: boolean
  isSelected:    boolean
  isDimmed:      boolean
  originalNode:  GraphNode
}

// ─── Node type accent colors (handles both PascalCase and lowercase) ──────────

function getNodeAccent(type: string): string {
  const t = type.toLowerCase()
  if (t === 'api')      return '#00d4ff'
  if (t === 'function') return '#00f084'
  if (t === 'class')    return '#b08eff'
  return '#ffc145'
}

// ─── Layout ───────────────────────────────────────────────────────────────────

const NODE_W = 200
const NODE_H = 48

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 44, ranksep: 90, marginx: 24, marginy: 24 })
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach((e) => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map((n) => {
    const pos = g.node(n.id)
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } }
  })
}

// ─── Custom Node ──────────────────────────────────────────────────────────────

const FunctionNode: React.FC<{ data: NodeData }> = ({ data }) => {
  const accent = getNodeAccent(data.nodeType)

  return (
    <div
      style={{
        width:      NODE_W,
        height:     NODE_H,
        background: data.isSelected
          ? `linear-gradient(135deg, ${accent}1a, ${accent}0d)`
          : data.isDimmed
          ? 'rgba(7,9,13,0.3)'
          : 'rgba(10,15,22,0.92)',
        border:     `1px solid ${
          data.isSelected    ? accent :
          data.isHighlighted ? accent + '66' :
          data.isDimmed      ? '#111820' :
          '#1a2535'
        }`,
        borderLeft: `3px solid ${data.isDimmed ? '#111820' : accent}`,
        borderRadius: 4,
        display:    'flex',
        alignItems: 'center',
        padding:    '0 10px 0 10px',
        gap:        8,
        boxShadow:  data.isSelected
          ? `0 0 20px ${accent}33, 0 2px 8px rgba(0,0,0,0.6)`
          : data.isHighlighted
          ? `0 0 10px ${accent}1a`
          : '0 2px 6px rgba(0,0,0,0.4)',
        opacity:    data.isDimmed ? 0.25 : 1,
        transition: 'all 0.18s ease',
        cursor:     'pointer',
        position:   'relative',
        overflow:   'hidden',
      }}
    >
      {/* Top shimmer on selected */}
      {data.isSelected && (
        <div style={{
          position:   'absolute',
          top: 0, left: 0, right: 0,
          height:     1,
          background: `linear-gradient(90deg, transparent, ${accent}cc, transparent)`,
        }} />
      )}

      {/* Type badge */}
      <div style={{
        fontSize:      8,
        fontFamily:    "'IBM Plex Mono', monospace",
        color:         data.isDimmed ? '#1e2d3d' : accent,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        flexShrink:    0,
        minWidth:      28,
      }}>
        {data.nodeType.toLowerCase().slice(0, 3)}
      </div>

      <span style={{
        fontFamily:   "'IBM Plex Mono', monospace",
        fontSize:     11,
        color:        data.isDimmed ? '#1e2d3d' : data.isSelected ? accent : '#8ab4c8',
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        whiteSpace:   'nowrap',
        flex:         1,
      }}>
        {data.label}
      </span>

      {/* Degree indicators */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {data.inDegree > 0 && (
          <span style={{ fontSize: 9, color: accent + '88', fontFamily: "'IBM Plex Mono'" }}>
            ←{data.inDegree}
          </span>
        )}
        {data.outDegree > 0 && (
          <span style={{ fontSize: 9, color: accent + '88', fontFamily: "'IBM Plex Mono'" }}>
            {data.outDegree}→
          </span>
        )}
      </div>

      <Handle type="target" position={Position.Left}  style={{ background: accent, width: 5, height: 5, border: 'none', left: -3 }} />
      <Handle type="source" position={Position.Right} style={{ background: accent, width: 5, height: 5, border: 'none', right: -3 }} />
    </div>
  )
}

const nodeTypes: NodeTypes = { function: FunctionNode }

// ─── Stat pill ────────────────────────────────────────────────────────────────

const StatPill: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
    <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 16, fontWeight: 700, color, letterSpacing: '-0.02em' }}>
      {value.toLocaleString()}
    </span>
    <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: '#3a5a6a', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
      {label}
    </span>
  </div>
)

// ─── Main Component ───────────────────────────────────────────────────────────

const CallGraphInner: React.FC = () => {
  const { callGraph, loadCallGraph, setSelectedNode } = useGraphStore()
  const { activeRepo } = useRepoStore()
  const { fitView } = useReactFlow()

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [searchQuery, setSearchQuery]    = useState('')
  const [depth, setDepth]                = useState(2)
  const [focusNodeId, setFocusNodeId]    = useState<string | null>(null)
  const [panelNode, setPanelNode]        = useState<GraphNode | null>(null)

  useEffect(() => {
    if (activeRepo?.graphId) {
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

  // BFS reachability from focused node
  const visibleIds = useMemo(() => {
    if (!rawData || !focusNodeId) return null
    const visited  = new Set<string>()
    const outAdj   = new Map<string, string[]>()
    const inAdj    = new Map<string, string[]>()
    rawData.edges.forEach((e) => {
      if (!outAdj.has(e.source)) outAdj.set(e.source, [])
      if (!inAdj.has(e.target))  inAdj.set(e.target, [])
      outAdj.get(e.source)!.push(e.target)
      inAdj.get(e.target)!.push(e.source)
    })
    const queue: [string, number][] = [[focusNodeId, 0]]
    while (queue.length > 0) {
      const [id, d] = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      if (d < depth) {
        outAdj.get(id)?.forEach((nid) => queue.push([nid, d + 1]))
        inAdj.get(id)?.forEach((nid) => queue.push([nid, d + 1]))
      }
    }
    return visited
  }, [rawData, focusNodeId, depth])

  // Build ReactFlow nodes/edges
  useEffect(() => {
    if (!rawData) return

    const searchLower = searchQuery.toLowerCase()
    const matchIds    = searchQuery
      ? new Set(rawData.nodes.filter((n) => (n.label ?? '').toLowerCase().includes(searchLower)).map((n) => n.id))
      : null

    const rfNodes: Node<NodeData>[] = rawData.nodes
      .filter((n) => !visibleIds || visibleIds.has(n.id))
      .map((n) => {
        const deg           = degreeMap.get(n.id) ?? { in: 0, out: 0 }
        const isHighlighted = matchIds ? matchIds.has(n.id) : false
        const isDimmed      = matchIds ? matchIds.size > 0 && !matchIds.has(n.id) : false
        const isSelected    = n.id === focusNodeId
        return {
          id:       n.id,
          type:     'function',
          position: { x: 0, y: 0 },
          data: {
            label:         n.label,
            nodeType:      n.type,
            inDegree:      deg.in,
            outDegree:     deg.out,
            isHighlighted,
            isSelected,
            isDimmed,
            originalNode:  n,
          },
        }
      })

    const visibleNodeIds = new Set(rfNodes.map((n) => n.id))
    const rfEdges: Edge[] = rawData.edges
      .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
      .map((e) => {
        const isFocused = focusNodeId && (e.source === focusNodeId || e.target === focusNodeId)
        return {
          id:     `${e.source}->${e.target}`,
          source: e.source,
          target: e.target,
          type:   'smoothstep',
          animated: !!isFocused,
          style: {
            stroke:      isFocused ? '#00f084' : '#1a2d20',
            strokeWidth: isFocused ? 2 : 1,
            opacity:     matchIds && matchIds.size > 0 ? 0.2 : 0.65,
          },
          markerEnd: {
            type:   MarkerType.ArrowClosed,
            color:  isFocused ? '#00f084' : '#1a2d20',
            width:  10,
            height: 10,
          },
        }
      })

    const laid = applyDagreLayout(rfNodes, rfEdges)
    setNodes(laid)
    setEdges(rfEdges)
    setTimeout(() => fitView({ padding: 0.12, duration: 450 }), 60)
  }, [rawData, searchQuery, focusNodeId, depth, degreeMap])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    const orig = node.data.originalNode
    if (focusNodeId === orig.id) {
      setFocusNodeId(null); setPanelNode(null); setSelectedNode(null)
    } else {
      setFocusNodeId(orig.id); setPanelNode(orig); setSelectedNode(orig)
    }
  }, [focusNodeId])

  const handleReset = () => {
    setFocusNodeId(null); setPanelNode(null); setSelectedNode(null); setSearchQuery('')
    setTimeout(() => fitView({ padding: 0.12, duration: 450 }), 60)
  }

  // Type distribution for legend
  const typeCounts = useMemo(() => {
    if (!rawData) return {}
    const counts: Record<string, number> = {}
    rawData.nodes.forEach((n) => {
      const t = n.type.toLowerCase()
      counts[t] = (counts[t] ?? 0) + 1
    })
    return counts
  }, [rawData])

  const nodeCount = rawData?.nodes.length ?? 0
  const edgeCount = rawData?.edges.length ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#07090d' }}>

      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        gap:            16,
        padding:        '10px 16px',
        borderBottom:   '1px solid #0d1a24',
        background:     'rgba(7,9,13,0.97)',
        backdropFilter: 'blur(12px)',
        flexShrink:     0,
      }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 4 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#00f084', boxShadow: '0 0 10px #00f084aa',
          }} />
          <span style={{
            fontFamily:    "'Syne', sans-serif",
            fontSize:      12,
            fontWeight:    700,
            color:         '#00f084',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            调用图
          </span>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 20, marginRight: 'auto' }}>
          <StatPill label="节点" value={nodeCount} color="#00d4ff" />
          <StatPill label="调用" value={edgeCount} color="#00f084" />
        </div>

        {/* Type legend */}
        <div style={{ display: 'flex', gap: 10, marginRight: 8 }}>
          {Object.entries(typeCounts).map(([type, count]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 6, height: 6, borderRadius: 1,
                background: getNodeAccent(type),
              }} />
              <span style={{
                fontFamily:    "'IBM Plex Mono'",
                fontSize:      9,
                color:         '#3a5a6a',
                letterSpacing: '0.08em',
              }}>
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
            width:      200,
            background: '#080e16',
            border:     '1px solid #1a2535',
            borderRadius: 3,
            color:      '#8ab4c8',
            fontFamily: "'IBM Plex Mono'",
            fontSize:   11,
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
            min={1} max={6} value={depth}
            onChange={setDepth}
            style={{ width: 72 }}
            tooltip={{ formatter: (v) => `${v} 层` }}
          />
          <span style={{
            fontFamily:  "'IBM Plex Mono'",
            fontSize:    12,
            fontWeight:  700,
            color:       '#00f084',
            minWidth:    14,
          }}>
            {depth}
          </span>
        </div>

        <Tooltip title="重置视图">
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            size="small"
            style={{ background: '#080e16', border: '1px solid #1a2535', color: '#2a4a5a' }}
          />
        </Tooltip>
      </div>

      {/* ── Graph canvas ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>

        {callGraph.loading && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(7,9,13,0.85)', zIndex: 10, gap: 12,
          }}>
            <Spin size="large" />
            <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: '#2a4a5a', letterSpacing: '0.12em' }}>
              加载调用图...
            </span>
          </div>
        )}

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

        {activeRepo && !callGraph.loading && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.08}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={28}
              size={0.8}
              color="#0d1a24"
            />
            <Controls style={{ background: '#080e16', border: '1px solid #1a2535' }} />
            <MiniMap
              style={{ background: '#07090d', border: '1px solid #1a2535' }}
              nodeColor={(n) => getNodeAccent((n.data as NodeData).nodeType)}
              maskColor="rgba(7,9,13,0.75)"
            />
          </ReactFlow>
        )}

        {panelNode && (
          <NodeDetailPanel
            node={panelNode}
            edges={rawData?.edges}
            allNodes={rawData?.nodes}
            onClose={() => { setPanelNode(null); setFocusNodeId(null); setSelectedNode(null) }}
          />
        )}
      </div>

      {/* ── Focus hint ───────────────────────────────────────────────────────── */}
      {focusNodeId && (
        <div style={{
          position:      'absolute',
          bottom:        20,
          left:          '50%',
          transform:     'translateX(-50%)',
          background:    'rgba(0,240,132,0.08)',
          border:        '1px solid rgba(0,240,132,0.2)',
          borderRadius:  3,
          padding:       '5px 14px',
          fontFamily:    "'IBM Plex Mono'",
          fontSize:      10,
          color:         '#00f084',
          pointerEvents: 'none',
          zIndex:        5,
          letterSpacing: '0.06em',
          backdropFilter: 'blur(8px)',
        }}>
          显示 {depth} 层调用链 · 再次点击节点可重置
        </div>
      )}
    </div>
  )
}

const CallGraph: React.FC = () => (
  <ReactFlowProvider>
    <CallGraphInner />
  </ReactFlowProvider>
)

export default CallGraph
