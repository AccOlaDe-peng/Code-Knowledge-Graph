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
import { Input, Slider, Button, Tooltip, Empty, Spin } from 'antd'
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons'
import { useGraphStore } from '../../store/graphStore'
import { useRepoStore } from '../../store/repoStore'
import NodeDetailPanel from '../../components/NodeDetailPanel'
import type { GraphNode } from '../../types/graph'

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeData = {
  label:        string
  nodeType:     string
  inDegree:     number
  outDegree:    number
  isHighlighted: boolean
  isSelected:   boolean
  isDimmed:     boolean
  originalNode: GraphNode
}

// ─── Layout ───────────────────────────────────────────────────────────────────

const NODE_W = 180
const NODE_H = 48

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80, marginx: 20, marginy: 20 })
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
  const isApi = data.nodeType === 'API'
  const accent = isApi ? '#00d4ff' : '#00f084'

  return (
    <div
      style={{
        width: NODE_W,
        height: NODE_H,
        background: data.isSelected
          ? `linear-gradient(135deg, ${accent}22, ${accent}11)`
          : data.isDimmed
          ? 'rgba(7,9,13,0.4)'
          : 'rgba(7,9,13,0.85)',
        border: `1px solid ${data.isSelected ? accent : data.isHighlighted ? accent + '88' : data.isDimmed ? '#1a2030' : '#1e2d3d'}`,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 8,
        boxShadow: data.isSelected
          ? `0 0 16px ${accent}44, 0 0 4px ${accent}22`
          : data.isHighlighted
          ? `0 0 8px ${accent}22`
          : 'none',
        opacity: data.isDimmed ? 0.3 : 1,
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {data.isSelected && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        }} />
      )}

      <div style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: accent,
        boxShadow: `0 0 6px ${accent}`,
        flexShrink: 0,
      }} />

      <span style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
        color: data.isDimmed ? '#3a4a5a' : data.isSelected ? accent : '#8ab4c8',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {data.label}
      </span>

      {data.outDegree > 0 && (
        <span style={{
          fontSize: 9,
          color: accent + '99',
          fontFamily: "'IBM Plex Mono', monospace",
          flexShrink: 0,
        }}>
          {data.outDegree}→
        </span>
      )}

      <Handle type="target" position={Position.Left} style={{ background: accent, width: 6, height: 6, border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: accent, width: 6, height: 6, border: 'none' }} />
    </div>
  )
}

const nodeTypes: NodeTypes = { function: FunctionNode }

// ─── Main Component ───────────────────────────────────────────────────────────

const CallGraphInner: React.FC = () => {
  const { callGraph, loadCallGraph, setSelectedNode } = useGraphStore()
  const { activeRepo } = useRepoStore()
  const { fitView } = useReactFlow()

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [depth, setDepth] = useState(2)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  const [panelNode, setPanelNode] = useState<GraphNode | null>(null)

  useEffect(() => {
    if (activeRepo?.graphId) {
      loadCallGraph(activeRepo.graphId)
    }
  }, [activeRepo?.graphId])

  const rawData = callGraph.data

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

  const visibleIds = useMemo(() => {
    if (!rawData || !focusNodeId) return null
    const visited = new Set<string>()
    const queue: [string, number][] = [[focusNodeId, 0]]
    const outAdj = new Map<string, string[]>()
    const inAdj  = new Map<string, string[]>()
    rawData.edges.forEach((e) => {
      if (!outAdj.has(e.source)) outAdj.set(e.source, [])
      if (!inAdj.has(e.target))  inAdj.set(e.target, [])
      outAdj.get(e.source)!.push(e.target)
      inAdj.get(e.target)!.push(e.source)
    })
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

  useEffect(() => {
    if (!rawData) return

    const searchLower = searchQuery.toLowerCase()
    const matchIds = searchQuery
      ? new Set(rawData.nodes.filter((n) => n.label.toLowerCase().includes(searchLower)).map((n) => n.id))
      : null

    const rfNodes: Node<NodeData>[] = rawData.nodes
      .filter((n) => !visibleIds || visibleIds.has(n.id))
      .map((n) => {
        const deg = degreeMap.get(n.id) ?? { in: 0, out: 0 }
        const isHighlighted = matchIds ? matchIds.has(n.id) : false
        const isDimmed = matchIds ? matchIds.size > 0 && !matchIds.has(n.id) : false
        const isSelected = n.id === focusNodeId
        return {
          id: n.id,
          type: 'function',
          position: { x: 0, y: 0 },
          data: {
            label: n.label,
            nodeType: n.type,
            inDegree: deg.in,
            outDegree: deg.out,
            isHighlighted,
            isSelected,
            isDimmed,
            originalNode: n,
          },
        }
      })

    const visibleNodeIds = new Set(rfNodes.map((n) => n.id))
    const rfEdges: Edge[] = rawData.edges
      .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
      .map((e) => ({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        animated: focusNodeId ? (e.source === focusNodeId || e.target === focusNodeId) : false,
        style: {
          stroke: focusNodeId && (e.source === focusNodeId || e.target === focusNodeId)
            ? '#00f084'
            : '#1e3a2a',
          strokeWidth: 1.5,
          opacity: matchIds && matchIds.size > 0 ? 0.3 : 0.7,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: focusNodeId && (e.source === focusNodeId || e.target === focusNodeId)
            ? '#00f084'
            : '#1e3a2a',
          width: 12,
          height: 12,
        },
      }))

    const laid = applyDagreLayout(rfNodes, rfEdges)
    setNodes(laid)
    setEdges(rfEdges)

    setTimeout(() => fitView({ padding: 0.1, duration: 400 }), 50)
  }, [rawData, searchQuery, focusNodeId, depth, degreeMap])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    const orig = node.data.originalNode
    if (focusNodeId === orig.id) {
      setFocusNodeId(null)
      setPanelNode(null)
      setSelectedNode(null)
    } else {
      setFocusNodeId(orig.id)
      setPanelNode(orig)
      setSelectedNode(orig)
    }
  }, [focusNodeId])

  const handleReset = () => {
    setFocusNodeId(null)
    setPanelNode(null)
    setSelectedNode(null)
    setSearchQuery('')
    setTimeout(() => fitView({ padding: 0.1, duration: 400 }), 50)
  }

  const nodeCount = rawData?.nodes.length ?? 0
  const edgeCount = rawData?.edges.length ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#07090d' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        borderBottom: '1px solid #0d1a24',
        background: 'rgba(7,9,13,0.95)',
        backdropFilter: 'blur(8px)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00f084', boxShadow: '0 0 8px #00f084' }} />
          <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: '#00f084', letterSpacing: '0.08em' }}>
            CALL GRAPH
          </span>
        </div>

        <div style={{ display: 'flex', gap: 12, marginRight: 'auto' }}>
          {[
            { label: 'NODES', value: nodeCount },
            { label: 'EDGES', value: edgeCount },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
              <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 14, fontWeight: 600, color: '#00d4ff' }}>{value}</span>
              <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: '#3a5a6a', letterSpacing: '0.1em' }}>{label}</span>
            </div>
          ))}
        </div>

        <Input
          prefix={<SearchOutlined style={{ color: '#3a5a6a', fontSize: 12 }} />}
          placeholder="Search function..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: 200,
            background: '#0a1520',
            border: '1px solid #1e2d3d',
            borderRadius: 4,
            color: '#8ab4c8',
            fontFamily: "'IBM Plex Mono'",
            fontSize: 12,
          }}
          allowClear
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: '#3a5a6a', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
            DEPTH
          </span>
          <Slider
            min={1} max={5} value={depth}
            onChange={setDepth}
            style={{ width: 80 }}
            tooltip={{ formatter: (v) => `${v} levels` }}
          />
          <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12, color: '#00f084', minWidth: 12 }}>{depth}</span>
        </div>

        <Tooltip title="Reset view">
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            size="small"
            style={{ background: '#0a1520', border: '1px solid #1e2d3d', color: '#3a5a6a' }}
          />
        </Tooltip>
      </div>

      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
        {callGraph.loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(7,9,13,0.8)', zIndex: 10,
          }}>
            <Spin size="large" />
          </div>
        )}

        {!activeRepo && !callGraph.loading && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty
              description={<span style={{ color: '#3a5a6a', fontFamily: "'IBM Plex Mono'", fontSize: 12 }}>Select a repository to view call graph</span>}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
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
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="#0d1a24"
            />
            <Controls
              style={{ background: '#0a1520', border: '1px solid #1e2d3d' }}
            />
            <MiniMap
              style={{ background: '#07090d', border: '1px solid #1e2d3d' }}
              nodeColor={(n) => {
                const d = n.data as NodeData
                return d.nodeType === 'API' ? '#00d4ff' : '#00f084'
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
              setFocusNodeId(null)
              setSelectedNode(null)
            }}
          />
        )}
      </div>

      {focusNodeId && (
        <div style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,240,132,0.1)',
          border: '1px solid #00f08444',
          borderRadius: 4,
          padding: '4px 12px',
          fontFamily: "'IBM Plex Mono'",
          fontSize: 11,
          color: '#00f084',
          pointerEvents: 'none',
          zIndex: 5,
        }}>
          Showing {depth}-level call chain · Click node again to reset
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
