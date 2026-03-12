import React, { useEffect, useState } from 'react'
import { Alert, Spin } from 'antd'
import { GraphViewer, NodeDetailPanel, GraphToolbar, SearchBar } from '../../components'
import type { GraphNode, GraphEdge } from '../../types/graph'
import type { LayoutName } from '../../components/graph/GraphViewer'
import { useGraphStore } from '../../store/graphStore'

// ─── Architecture Explorer ────────────────────────────────────────────────────

const ArchitectureExplorer: React.FC = () => {
  const { activeGraphId, graph, loadGraph } = useGraphStore()
  const [layout, setLayout] = useState<LayoutName>('force')
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [filteredNodes, setFilteredNodes] = useState<GraphNode[]>([])
  const [filteredEdges, setFilteredEdges] = useState<GraphEdge[]>([])

  // Load graph data
  useEffect(() => {
    if (activeGraphId) {
      loadGraph(activeGraphId)
    }
  }, [activeGraphId, loadGraph])

  // Initialize filtered data
  useEffect(() => {
    if (graph.data) {
      setFilteredNodes(graph.data.nodes)
      setFilteredEdges(graph.data.edges)
    }
  }, [graph.data])

  const handleSearch = (query: string) => {
    if (!graph.data) return

    if (!query.trim()) {
      setFilteredNodes(graph.data.nodes)
      setFilteredEdges(graph.data.edges)
      return
    }

    const q = query.toLowerCase()
    const matchedNodes = graph.data.nodes.filter(
      (node: GraphNode) =>
        node.label?.toLowerCase().includes(q) ||
        node.id.toLowerCase().includes(q) ||
        node.type.toLowerCase().includes(q)
    )

    const matchedNodeIds = new Set(matchedNodes.map((n: GraphNode) => n.id))
    const matchedEdges = graph.data.edges.filter(
      (edge: GraphEdge) => matchedNodeIds.has(edge.source) || matchedNodeIds.has(edge.target)
    )

    setFilteredNodes(matchedNodes)
    setFilteredEdges(matchedEdges)
  }

  const handleNodeSelect = (node: GraphNode) => {
    setSelectedNode(node)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Page Header */}
      <div>
        <div
          style={{
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            color: 'var(--t-muted)',
            letterSpacing: '0.15em',
            marginBottom: 4,
          }}
        >
          SYSTEM / ARCHITECTURE
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--t-primary)',
            fontFamily: 'var(--font-ui)',
          }}
        >
          Architecture Explorer
        </h2>
      </div>

      {/* No repo selected */}
      {!activeGraphId && (
        <Alert
          type="info"
          message="Please select a repository from the top bar to explore its architecture"
          showIcon
        />
      )}

      {/* Loading state */}
      {graph.loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
          <Spin size="large" />
        </div>
      )}

      {/* Error state */}
      {graph.error && (
        <Alert type="error" message="Failed to load graph" description={graph.error} showIcon />
      )}

      {/* Main content */}
      {activeGraphId && graph.data && !graph.loading && (
        <>
          {/* Search bar */}
          <SearchBar
            nodes={graph.data.nodes}
            onSearch={handleSearch}
            onSelect={handleNodeSelect}
            showTypeFilter
          />

          {/* Graph toolbar */}
          <GraphToolbar
            layout={layout}
            onLayoutChange={setLayout}
            nodeCount={filteredNodes.length}
            edgeCount={filteredEdges.length}
            showStats
          />

          {/* Graph viewer */}
          <div style={{ flex: 1, minHeight: 600 }}>
            <GraphViewer
              nodes={filteredNodes}
              edges={filteredEdges}
              layout={layout}
              onNodeClick={handleNodeSelect}
              height="100%"
            />
          </div>

          {/* Node detail panel */}
          <NodeDetailPanel
            node={selectedNode}
            edges={graph.data.edges}
            allNodes={graph.data.nodes}
            onClose={() => setSelectedNode(null)}
          />
        </>
      )}
    </div>
  )
}

export default ArchitectureExplorer
