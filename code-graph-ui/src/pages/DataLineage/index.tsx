import React, { useCallback, useEffect, useState } from 'react'
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
import { Input, Checkbox, Button, Tooltip, Empty, Spin } from 'antd'
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons'
import { useGraphStore } from '../../store/graphStore'
import { useRepoStore } from '../../store/repoStore'
import NodeDetailPanel from '../../components/NodeDetailPanel'
import type { GraphNode } from '../../types/graph'

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeData = {
  label:        string
  nodeType:     string
  isHighlighted: boolean
  isDimmed:     boolean
  originalNode: GraphNode
}

const EDGE_COLORS: Record<string, string> = {
  produces:   '#00f084',
  reads:      '#00d4ff',
  writes:     '#ffc145',
  depends_on: '#b08eff',
  consumes:   '#ff7a7a',
}

const NODE_SHAPES: Record<string, { width: number; height: number }> = {
  API:        { width: 160, height: 44 },
  Service:    { width: 140, height: 52 },
  Table:      { width: 150, height: 40 },
  DataObject: { width: 120, height: 120 },
  Module:     { width: 150, height: 44 },
  Function:   { width: 160, height: 40 },
  Component:  { width: 150, height: 44 },
  _default:   { width: 150, height: 44 },
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 100, marginx: 30, marginy: 30 })
  nodes.forEach((n) => {
    const shape = NODE_SHAPES[n.data.nodeType] ?? NODE_SHAPES._default
    g.setNode(n.id, { width: shape.width, height: shape.height })
  })
  edges.forEach((e) => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map((n) => {
    const pos = g.node(n.id)
    const shape = NODE_SHAPES[n.data.nodeType] ?? NODE_SHAPES._default
    return { ...n, position: { x: pos.x - shape.width / 2, y: pos.y - shape.height / 2 } }
  })
}

// ─── Node Colors ──────────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, { accent: string; bg: string; border: string }> = {
  API:        { accent: '#00d4ff', bg: 'rgba(0,212,255,0.06)', border: 'rgba(0,212,255,0.3)' },
  Service:    { accent: '#b08eff', bg: 'rgba(176,142,255,0.06)', border: 'rgba(176,142,255,0.3)' },
  Table:      { accent: '#ffc145', bg: 'rgba(255,193,69,0.06)', border: 'rgba(255,193,69,0.3)' },
  DataObject: { accent: '#00f084', bg: 'rgba(0,240,132,0.06)', border: 'rgba(0,240,132,0.3)' },
  Module:     { accent: '#00d4ff', bg: 'rgba(0,212,255,0.06)', border: 'rgba(0,212,255,0.3)' },
  Function:   { accent: '#00f084', bg: 'rgba(0,240,132,0.06)', border: 'rgba(0,240,132,0.3)' },
  Component:  { accent: '#b08eff', bg: 'rgba(176,142,255,0.06)', border: 'rgba(176,142,255,0.3)' },
  _default:   { accent: '#3a5a6a', bg: 'rgba(58,90,106,0.06)', border: 'rgba(58,90,106,0.3)' },
}

function nodeColor(type: string) {
  return NODE_COLORS[type] ?? NODE_COLORS._default
}

// ─── Generic Node (handles all node types) ────────────────────────────────────

const GenericNode: React.FC<{ data: NodeData }> = ({ data }) => {
  const c = nodeColor(data.nodeType)
  const shape = NODE_SHAPES[data.nodeType] ?? NODE_SHAPES._default
  return (
    <div style={{
      width: shape.width, height: shape.height,
      background: data.isHighlighted ? c.bg : data.isDimmed ? 'rgba(7,9,13,0.3)' : 'rgba(7,9,13,0.9)',
      border: `1px solid ${data.isHighlighted ? c.accent : data.isDimmed ? '#111820' : c.border}`,
      borderRadius: 6,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 3,
      opacity: data.isDimmed ? 0.25 : 1,
      boxShadow: data.isHighlighted ? `0 0 20px ${c.accent}33` : 'none',
      transition: 'all 0.2s ease', cursor: 'pointer', position: 'relative', padding: '0 10px',
    }}>
      <span style={{ fontSize: 9, color: c.accent, fontFamily: "'IBM Plex Mono'", letterSpacing: '0.08em', textTransform: 'uppercase' }}>{data.nodeType}</span>
      <span style={{ fontSize: 11, color: data.isDimmed ? '#2a3a4a' : '#8ab4c8', fontFamily: "'IBM Plex Mono'", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: shape.width - 20, textAlign: 'center' }}>{data.label}</span>
      <Handle type="target" position={Position.Left} style={{ background: c.accent, width: 6, height: 6, border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: c.accent, width: 6, height: 6, border: 'none' }} />
    </div>
  )
}

// ReactFlow nodeTypes — 用动态类型时，在 rfNodes 中不设置 type 字段则用默认节点
// 这里注册已知类型，未知类型通过 rfNodes 映射到 'generic'
const nodeTypes: NodeTypes = { generic: GenericNode }

// ─── Main Component ───────────────────────────────────────────────────────────

const DataLineageInner: React.FC = () => {
  const { lineageGraph, loadLineage, setSelectedNode } = useGraphStore()
  const { activeRepo } = useRepoStore()
  const { fitView } = useReactFlow()

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [visibleNodeTypes, setVisibleNodeTypes] = useState<Set<string>>(new Set())
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<string>>(new Set())
  const [panelNode, setPanelNode] = useState<GraphNode | null>(null)
  const [availableNodeTypes, setAvailableNodeTypes] = useState<string[]>([])
  const [availableEdgeTypes, setAvailableEdgeTypes] = useState<string[]>([])

  useEffect(() => {
    if (activeRepo?.graphId) {
      loadLineage(activeRepo.graphId)
    }
  }, [activeRepo?.graphId])

  const rawData = lineageGraph.data

  // 初始化可见类型（从实际数据推断）
  useEffect(() => {
    if (!rawData) return

    const nodeTypes = Array.from(new Set(rawData.nodes.map(n => n.type)))
    const edgeTypes = Array.from(new Set(rawData.edges.map(e => e.type)))

    setAvailableNodeTypes(nodeTypes)
    setAvailableEdgeTypes(edgeTypes)
    setVisibleNodeTypes(new Set(nodeTypes))
    setVisibleEdgeTypes(new Set(edgeTypes))
  }, [rawData])

  useEffect(() => {
    if (!rawData) return

    const searchLower = searchQuery.toLowerCase()
    const matchIds = searchQuery
      ? new Set(rawData.nodes.filter((n) => (n.label ?? '').toLowerCase().includes(searchLower)).map((n) => n.id))
      : null

    const filteredNodes = rawData.nodes.filter((n) => visibleNodeTypes.has(n.type))
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id))

    const filteredEdges = rawData.edges.filter(
      (e) => visibleEdgeTypes.has(e.type) && filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    )

    const rfNodes: Node<NodeData>[] = filteredNodes.map((n) => ({
      id: n.id,
      type: 'generic',
      position: { x: 0, y: 0 },
      data: {
        label: n.label,
        nodeType: n.type,
        isHighlighted: matchIds ? matchIds.has(n.id) : false,
        isDimmed: matchIds ? matchIds.size > 0 && !matchIds.has(n.id) : false,
        originalNode: n,
      },
    }))

    const rfEdges: Edge[] = filteredEdges.map((e) => {
      const color = EDGE_COLORS[e.type] ?? '#3a5a6a'
      return {
        id: `${e.source}-${e.type}-${e.target}`,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        animated: e.type === 'produces',
        label: e.type,
        labelStyle: { fontFamily: "'IBM Plex Mono'", fontSize: 9, fill: color + 'cc' },
        labelBgStyle: { fill: '#07090d', fillOpacity: 0.8 },
        style: { stroke: color, strokeWidth: 1.5, opacity: 0.7 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
      }
    })

    const laid = applyDagreLayout(rfNodes, rfEdges)
    setNodes(laid)
    setEdges(rfEdges)
    setTimeout(() => fitView({ padding: 0.12, duration: 400 }), 50)
  }, [rawData, searchQuery, visibleNodeTypes, visibleEdgeTypes])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    const orig = node.data.originalNode
    setPanelNode(orig)
    setSelectedNode(orig)
  }, [setSelectedNode])

  const toggleNodeType = (t: string) => {
    setVisibleNodeTypes((prev) => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }

  const toggleEdgeType = (t: string) => {
    setVisibleEdgeTypes((prev) => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }

  const handleReset = () => {
    setSearchQuery('')
    setVisibleNodeTypes(new Set(availableNodeTypes))
    setVisibleEdgeTypes(new Set(availableEdgeTypes))
    setPanelNode(null)
    setSelectedNode(null)
    setTimeout(() => fitView({ padding: 0.12, duration: 400 }), 50)
  }

  const nodeCount = rawData?.nodes.length ?? 0
  const edgeCount = rawData?.edges.length ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#07090d' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
        borderBottom: '1px solid #0d1a24', background: 'rgba(7,9,13,0.95)',
        backdropFilter: 'blur(8px)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#b08eff', boxShadow: '0 0 8px #b08eff' }} />
          <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: '#b08eff', letterSpacing: '0.08em' }}>
            数据血缘
          </span>
        </div>

        <div style={{ display: 'flex', gap: 12, marginRight: 'auto' }}>
          {[
            { label: '节点', value: nodeCount },
            { label: '边', value: edgeCount },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
              <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 14, fontWeight: 600, color: '#b08eff' }}>{value}</span>
              <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: '#3a5a6a', letterSpacing: '0.1em' }}>{label}</span>
            </div>
          ))}
        </div>

        <Input
          prefix={<SearchOutlined style={{ color: '#3a5a6a', fontSize: 12 }} />}
          placeholder="搜索..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: 180, background: '#0a1520', border: '1px solid #1e2d3d',
            borderRadius: 4, color: '#8ab4c8', fontFamily: "'IBM Plex Mono'", fontSize: 12,
          }}
          allowClear
        />

        <div style={{ display: 'flex', gap: 8, padding: '0 8px', borderLeft: '1px solid #1e2d3d' }}>
          {availableNodeTypes.map((t) => (
            <Checkbox
              key={t}
              checked={visibleNodeTypes.has(t)}
              onChange={() => toggleNodeType(t)}
              style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: nodeColor(t).accent }}
            >
              {t}
            </Checkbox>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '0 8px', borderLeft: '1px solid #1e2d3d' }}>
          {availableEdgeTypes.map((t) => (
            <Checkbox
              key={t}
              checked={visibleEdgeTypes.has(t)}
              onChange={() => toggleEdgeType(t)}
              style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: EDGE_COLORS[t] ?? '#3a5a6a' }}
            >
              {t}
            </Checkbox>
          ))}
        </div>

        <Tooltip title="重置视图">
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            size="small"
            style={{ background: '#0a1520', border: '1px solid #1e2d3d', color: '#3a5a6a' }}
          />
        </Tooltip>
      </div>

      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
        {lineageGraph.loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(7,9,13,0.8)', zIndex: 10,
          }}>
            <Spin size="large" />
          </div>
        )}

        {!activeRepo && !lineageGraph.loading && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty
              description={<span style={{ color: '#3a5a6a', fontFamily: "'IBM Plex Mono'", fontSize: 12 }}>请选择一个仓库以查看数据血缘</span>}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        )}

        {activeRepo && !lineageGraph.loading && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#0d1a24" />
            <Controls style={{ background: '#0a1520', border: '1px solid #1e2d3d' }} />
            <MiniMap
              style={{ background: '#07090d', border: '1px solid #1e2d3d' }}
              nodeColor={(n) => {
                const d = n.data as NodeData
                return nodeColor(d.nodeType).accent
              }}
              maskColor="rgba(7,9,13,0.8)"
            />
          </ReactFlow>
        )}

        {panelNode && (
          <NodeDetailPanel
            node={panelNode}
            edges={rawData?.edges}
            allNodes={rawData?.nodes}
            onClose={() => {
              setPanelNode(null)
              setSelectedNode(null)
            }}
          />
        )}
      </div>
    </div>
  )
}

const DataLineage: React.FC = () => (
  <ReactFlowProvider>
    <DataLineageInner />
  </ReactFlowProvider>
)

export default DataLineage
