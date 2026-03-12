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

const EDGE_COLORS = {
  produces: '#00f084',
  reads:    '#00d4ff',
  writes:   '#ffc145',
} as const

const NODE_SHAPES = {
  API:        { width: 160, height: 44, shape: 'rounded' },
  Service:    { width: 140, height: 52, shape: 'hexagon' },
  Table:      { width: 150, height: 40, shape: 'rect' },
  DataObject: { width: 120, height: 120, shape: 'circle' },
} as const

// ─── Layout ───────────────────────────────────────────────────────────────────

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 100, marginx: 30, marginy: 30 })
  nodes.forEach((n) => {
    const shape = NODE_SHAPES[n.data.nodeType as keyof typeof NODE_SHAPES] || NODE_SHAPES.DataObject
    g.setNode(n.id, { width: shape.width, height: shape.height })
  })
  edges.forEach((e) => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map((n) => {
    const pos = g.node(n.id)
    const shape = NODE_SHAPES[n.data.nodeType as keyof typeof NODE_SHAPES] || NODE_SHAPES.DataObject
    return { ...n, position: { x: pos.x - shape.width / 2, y: pos.y - shape.height / 2 } }
  })
}

// ─── Node Colors ──────────────────────────────────────────────────────────────

const NODE_COLORS = {
  API:        { accent: '#00d4ff', bg: 'rgba(0,212,255,0.06)', border: 'rgba(0,212,255,0.3)' },
  Service:    { accent: '#b08eff', bg: 'rgba(176,142,255,0.06)', border: 'rgba(176,142,255,0.3)' },
  Table:      { accent: '#ffc145', bg: 'rgba(255,193,69,0.06)', border: 'rgba(255,193,69,0.3)' },
  DataObject: { accent: '#00f084', bg: 'rgba(0,240,132,0.06)', border: 'rgba(0,240,132,0.3)' },
} as const

// ─── API Node ─────────────────────────────────────────────────────────────────

const ApiNode: React.FC<{ data: NodeData }> = ({ data }) => {
  const c = NODE_COLORS.API
  return (
    <div style={{
      width: 160, height: 44,
      background: data.isHighlighted ? c.bg : data.isDimmed ? 'rgba(7,9,13,0.3)' : 'rgba(7,9,13,0.9)',
      border: `1px solid ${data.isHighlighted ? c.accent : data.isDimmed ? '#111820' : c.border}`,
      borderRadius: 22,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      opacity: data.isDimmed ? 0.25 : 1,
      boxShadow: data.isHighlighted ? `0 0 20px ${c.accent}33` : 'none',
      transition: 'all 0.2s ease', cursor: 'pointer', position: 'relative',
    }}>
      <span style={{ fontSize: 10, color: c.accent, fontFamily: "'IBM Plex Mono'", letterSpacing: '0.05em' }}>API</span>
      <span style={{ fontSize: 11, color: data.isDimmed ? '#2a3a4a' : '#8ab4c8', fontFamily: "'IBM Plex Mono'", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{data.label}</span>
      <Handle type="target" position={Position.Left} style={{ background: c.accent, width: 6, height: 6, border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: c.accent, width: 6, height: 6, border: 'none' }} />
    </div>
  )
}

// ─── Service Node ─────────────────────────────────────────────────────────────

const ServiceNode: React.FC<{ data: NodeData }> = ({ data }) => {
  const c = NODE_COLORS.Service
  return (
    <div style={{
      width: 140, height: 52,
      background: data.isHighlighted ? c.bg : data.isDimmed ? 'rgba(7,9,13,0.3)' : 'rgba(7,9,13,0.9)',
      border: `1px solid ${data.isHighlighted ? c.accent : data.isDimmed ? '#111820' : c.border}`,
      borderRadius: 8,
      clipPath: 'polygon(12px 0%, calc(100% - 12px) 0%, 100% 50%, calc(100% - 12px) 100%, 12px 100%, 0% 50%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2,
      opacity: data.isDimmed ? 0.25 : 1,
      boxShadow: data.isHighlighted ? `0 0 20px ${c.accent}33` : 'none',
      transition: 'all 0.2s ease', cursor: 'pointer',
    }}>
      <span style={{ fontSize: 9, color: c.accent, fontFamily: "'IBM Plex Mono'", letterSpacing: '0.08em' }}>SVC</span>
      <span style={{ fontSize: 11, color: data.isDimmed ? '#2a3a4a' : '#c8b4e8', fontFamily: "'IBM Plex Mono'", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{data.label}</span>
      <Handle type="target" position={Position.Left} style={{ background: c.accent, width: 6, height: 6, border: 'none', left: -3 }} />
      <Handle type="source" position={Position.Right} style={{ background: c.accent, width: 6, height: 6, border: 'none', right: -3 }} />
    </div>
  )
}

// ─── Table Node ───────────────────────────────────────────────────────────────

const TableNode: React.FC<{ data: NodeData }> = ({ data }) => {
  const c = NODE_COLORS.Table
  return (
    <div style={{
      width: 150, height: 40,
      background: data.isHighlighted ? c.bg : data.isDimmed ? 'rgba(7,9,13,0.3)' : 'rgba(7,9,13,0.9)',
      border: `1px solid ${data.isHighlighted ? c.accent : data.isDimmed ? '#111820' : c.border}`,
      borderRadius: 3,
      display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
      opacity: data.isDimmed ? 0.25 : 1,
      boxShadow: data.isHighlighted ? `0 0 20px ${c.accent}33` : 'none',
      transition: 'all 0.2s ease', cursor: 'pointer', position: 'relative',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        {[0,1,2].map(i => <div key={i} style={{ width: 14, height: 2, background: data.isDimmed ? '#1a2a3a' : c.accent + '88', borderRadius: 1 }} />)}
      </div>
      <span style={{ fontSize: 11, color: data.isDimmed ? '#2a3a4a' : '#e8c88a', fontFamily: "'IBM Plex Mono'", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{data.label}</span>
      <Handle type="target" position={Position.Left} style={{ background: c.accent, width: 6, height: 6, border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: c.accent, width: 6, height: 6, border: 'none' }} />
    </div>
  )
}

// ─── DataObject Node ──────────────────────────────────────────────────────────

const DataObjectNode: React.FC<{ data: NodeData }> = ({ data }) => {
  const c = NODE_COLORS.DataObject
  return (
    <div style={{
      width: 120, height: 120,
      background: data.isHighlighted ? c.bg : data.isDimmed ? 'rgba(7,9,13,0.3)' : 'rgba(7,9,13,0.9)',
      border: `1px solid ${data.isHighlighted ? c.accent : data.isDimmed ? '#111820' : c.border}`,
      borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4,
      opacity: data.isDimmed ? 0.25 : 1,
      boxShadow: data.isHighlighted ? `0 0 24px ${c.accent}33, 0 0 8px ${c.accent}22` : 'none',
      transition: 'all 0.2s ease', cursor: 'pointer',
    }}>
      <span style={{ fontSize: 9, color: c.accent, fontFamily: "'IBM Plex Mono'", letterSpacing: '0.1em' }}>DATA</span>
      <span style={{ fontSize: 11, color: data.isDimmed ? '#2a3a4a' : '#8ae8b4', fontFamily: "'IBM Plex Mono'", textAlign: 'center', padding: '0 12px', lineHeight: 1.3, wordBreak: 'break-word' }}>{data.label}</span>
      <Handle type="target" position={Position.Left} style={{ background: c.accent, width: 6, height: 6, border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: c.accent, width: 6, height: 6, border: 'none' }} />
    </div>
  )
}

const nodeTypes: NodeTypes = {
  API:        ApiNode,
  Service:    ServiceNode,
  Table:      TableNode,
  DataObject: DataObjectNode,
}

// ─── Main Component ───────────────────────────────────────────────────────────

const ALL_NODE_TYPES = ['API', 'Service', 'Table', 'DataObject'] as const
const ALL_EDGE_TYPES = ['produces', 'reads', 'writes'] as const

const DataLineageInner: React.FC = () => {
  const { lineageGraph, loadLineage, setSelectedNode } = useGraphStore()
  const { activeRepo } = useRepoStore()
  const { fitView } = useReactFlow()

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [visibleNodeTypes, setVisibleNodeTypes] = useState<Set<string>>(new Set(ALL_NODE_TYPES))
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<string>>(new Set(ALL_EDGE_TYPES))
  const [panelNode, setPanelNode] = useState<GraphNode | null>(null)

  useEffect(() => {
    if (activeRepo?.graphId) {
      loadLineage(activeRepo.graphId)
    }
  }, [activeRepo?.graphId])

  const rawData = lineageGraph.data

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
      type: n.type,
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
      const color = EDGE_COLORS[e.type as keyof typeof EDGE_COLORS] ?? '#3a5a6a'
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
  }, [])

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
    setVisibleNodeTypes(new Set(ALL_NODE_TYPES))
    setVisibleEdgeTypes(new Set(ALL_EDGE_TYPES))
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
          {ALL_NODE_TYPES.map((t) => (
            <Checkbox
              key={t}
              checked={visibleNodeTypes.has(t)}
              onChange={() => toggleNodeType(t)}
              style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: NODE_COLORS[t as keyof typeof NODE_COLORS].accent }}
            >
              {t}
            </Checkbox>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '0 8px', borderLeft: '1px solid #1e2d3d' }}>
          {ALL_EDGE_TYPES.map((t) => (
            <Checkbox
              key={t}
              checked={visibleEdgeTypes.has(t)}
              onChange={() => toggleEdgeType(t)}
              style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: EDGE_COLORS[t as keyof typeof EDGE_COLORS] }}
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
                return NODE_COLORS[d.nodeType as keyof typeof NODE_COLORS]?.accent ?? '#3a5a6a'
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
