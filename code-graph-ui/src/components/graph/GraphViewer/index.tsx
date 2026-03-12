import React, { useEffect, useRef, useCallback, useState } from 'react'
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import coseBilkent from 'cytoscape-cose-bilkent'
import type { GraphNode, GraphEdge } from '../../../types/graph'
import { NodeTypeColors, EdgeTypeColors } from '../../../theme'

// Register layout plugins (idempotent)
cytoscape.use(dagre)
cytoscape.use(coseBilkent)

// ─── Types ────────────────────────────────────────────────────────────────────

export type LayoutName = 'grid' | 'dagre' | 'force'

export type GraphViewerProps = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  layout?: LayoutName
  onNodeClick?: (node: GraphNode) => void
  height?: string | number
}

// ─── Colour palette (from theme) ─────────────────────────────────────────────

const NODE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  Module:         { bg: NodeTypeColors.Module.bg,         border: NodeTypeColors.Module.primary,         text: NodeTypeColors.Module.text },
  Component:      { bg: NodeTypeColors.Component.bg,      border: NodeTypeColors.Component.primary,      text: NodeTypeColors.Component.text },
  Function:       { bg: NodeTypeColors.Function.bg,       border: NodeTypeColors.Function.primary,       text: NodeTypeColors.Function.text },
  Class:          { bg: NodeTypeColors.Class.bg,          border: NodeTypeColors.Class.primary,          text: NodeTypeColors.Class.text },
  Service:        { bg: NodeTypeColors.Service.bg,        border: NodeTypeColors.Service.primary,        text: NodeTypeColors.Service.text },
  Database:       { bg: NodeTypeColors.Database.bg,       border: NodeTypeColors.Database.primary,       text: NodeTypeColors.Database.text },
  API:            { bg: NodeTypeColors.API.bg,            border: NodeTypeColors.API.primary,            text: NodeTypeColors.API.text },
  Event:          { bg: NodeTypeColors.Event.bg,          border: NodeTypeColors.Event.primary,          text: NodeTypeColors.Event.text },
  Cluster:        { bg: NodeTypeColors.Cluster.bg,        border: NodeTypeColors.Cluster.primary,        text: NodeTypeColors.Cluster.text },
  Infrastructure: { bg: NodeTypeColors.Infrastructure.bg, border: NodeTypeColors.Infrastructure.primary, text: NodeTypeColors.Infrastructure.text },
  default:        { bg: '#1a1d26', border: '#6b7a9d', text: '#b0bcd8' },
}

const EDGE_COLORS: Record<string, string> = {
  calls:       EdgeTypeColors.calls,
  depends_on:  EdgeTypeColors.depends_on,
  imports:     EdgeTypeColors.imports,
  contains:    EdgeTypeColors.contains,
  reads:       EdgeTypeColors.reads,
  writes:      EdgeTypeColors.writes,
  produces:    EdgeTypeColors.produces,
  consumes:    EdgeTypeColors.consumes,
  publishes:   EdgeTypeColors.publishes,
  subscribes:  EdgeTypeColors.subscribes,
  default:     '#6b7a9d',
}

function getNodeColor(type: string) {
  return NODE_COLORS[type] ?? NODE_COLORS.default
}
function getEdgeColor(type: string) {
  return EDGE_COLORS[type] ?? EDGE_COLORS.default
}

// ─── Layout configs ───────────────────────────────────────────────────────────

function buildLayoutOptions(name: LayoutName): cytoscape.LayoutOptions {
  switch (name) {
    case 'dagre':
      return {
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 60,
        rankSep: 80,
        padding: 40,
        animate: true,
        animationDuration: 400,
      } as cytoscape.LayoutOptions
    case 'force':
      return {
        name: 'cose-bilkent',
        animate: 'during',
        animationDuration: 600,
        nodeRepulsion: 8000,
        idealEdgeLength: 120,
        edgeElasticity: 0.45,
        gravity: 0.25,
        padding: 40,
      } as cytoscape.LayoutOptions
    case 'grid':
    default:
      return {
        name: 'grid',
        padding: 40,
        avoidOverlap: true,
        animate: true,
        animationDuration: 400,
        condense: false,
      }
  }
}

// ─── Cytoscape stylesheet ─────────────────────────────────────────────────────

function buildStylesheet(): cytoscape.StylesheetStyle[] {
  return [
    {
      selector: 'node',
      style: {
        'width': 48,
        'height': 48,
        'shape': 'round-rectangle',
        'background-color': 'data(bg)',
        'border-width': 2,
        'border-color': 'data(borderColor)',
        'label': 'data(label)',
        'color': 'data(textColor)',
        'font-size': 11,
        'font-family': '"IBM Plex Mono", monospace',
        'font-weight': 500,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 7,
        'text-max-width': '110px',
        'text-overflow-wrap': 'whitespace',
        'text-wrap': 'ellipsis',
        'overlay-opacity': 0,
        'transition-property': 'border-color, border-width, background-color',
        'transition-duration': 150,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 3,
        'border-color': '#00d4ff',
        'background-color': 'data(bgSelected)',
      },
    },
    {
      selector: 'node:active',
      style: { 'overlay-opacity': 0.08, 'overlay-color': '#ffffff' },
    },
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 2.5,
        'border-color': '#00d4ff',
        'background-color': 'data(bgSelected)',
      },
    },
    {
      selector: 'node.faded',
      style: { 'opacity': 0.25 },
    },
    {
      selector: 'edge',
      style: {
        'width': 1.5,
        'line-color': 'data(edgeColor)',
        'target-arrow-color': 'data(edgeColor)',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 1,
        'curve-style': 'bezier',
        'opacity': 0.75,
        'label': 'data(edgeLabel)',
        'font-size': 9,
        'font-family': '"IBM Plex Mono", monospace',
        'color': 'data(edgeColor)',
        'text-rotation': 'autorotate',
        'text-margin-y': -6,
        'overlay-opacity': 0,
        'transition-property': 'opacity',
        'transition-duration': 150,
      },
    },
    {
      selector: 'edge:selected',
      style: { 'width': 2, 'opacity': 1 },
    },
    {
      selector: 'edge.faded',
      style: { 'opacity': 0.12 },
    },
  ]
}

// ─── Layout Switcher UI ───────────────────────────────────────────────────────

const LAYOUTS: { name: LayoutName; icon: string; label: string }[] = [
  { name: 'grid',  icon: '⊞', label: 'Grid'  },
  { name: 'dagre', icon: '⇣', label: 'Dagre' },
  { name: 'force', icon: '⊙', label: 'Force' },
]

// ─── GraphViewer ─────────────────────────────────────────────────────────────

const GraphViewer: React.FC<GraphViewerProps> = ({
  nodes,
  edges,
  layout: layoutProp = 'force',
  onNodeClick,
  height = '100%',
}) => {
  const containerRef  = useRef<HTMLDivElement>(null)
  const cyRef         = useRef<cytoscape.Core | null>(null)
  const [activeLayout, setActiveLayout] = useState<LayoutName>(layoutProp)
  const [nodeCount,    setNodeCount]    = useState(0)
  const [edgeCount,    setEdgeCount]    = useState(0)
  const [zoom,         setZoom]         = useState(1)

  // ── Build cy elements ──────────────────────────────────────────────────────

  const buildElements = useCallback(() => {
    const cyNodes: cytoscape.NodeDefinition[] = nodes.map((n) => {
      const c = getNodeColor(n.type)
      return {
        data: {
          id:         n.id,
          label:      (n.label ?? n.id ?? '').length > 18 ? (n.label ?? n.id ?? '').slice(0, 16) + '…' : (n.label ?? n.id ?? ''),
          fullLabel:  n.label,
          nodeType:   n.type,
          bg:         c.bg,
          bgSelected: c.bg.replace('0d', '18').replace('1a', '22'),
          borderColor: c.border,
          textColor:  c.text,
          raw:        n,
        },
      }
    })

    const cyEdges: cytoscape.EdgeDefinition[] = edges.map((e, i) => ({
      data: {
        id:        `e-${i}-${e.source}-${e.target}`,
        source:    e.source,
        target:    e.target,
        edgeColor: getEdgeColor(e.type),
        edgeLabel: e.type,
        edgeType:  e.type,
      },
    }))

    return [...cyNodes, ...cyEdges]
  }, [nodes, edges])

  // ── Init Cytoscape ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return

    const cy = cytoscape({
      container: containerRef.current,
      elements:  buildElements(),
      style:     buildStylesheet(),
      layout:    buildLayoutOptions(activeLayout),
      zoom:      1,
      minZoom:   0.1,
      maxZoom:   5,
      wheelSensitivity: 0.3,
    })

    cyRef.current = cy

    // Stats
    setNodeCount(cy.nodes().length)
    setEdgeCount(cy.edges().length)

    // Zoom tracking
    cy.on('zoom', () => setZoom(parseFloat(cy.zoom().toFixed(2))))

    // Node click — highlight neighbours + fire callback
    cy.on('tap', 'node', (evt) => {
      const node = evt.target
      const raw  = node.data('raw') as GraphNode

      cy.elements().removeClass('highlighted faded')
      const neighbourhood = node.closedNeighborhood()
      neighbourhood.addClass('highlighted')
      cy.elements().not(neighbourhood).addClass('faded')

      onNodeClick?.(raw)
    })

    // Click background — reset highlighting
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        cy.elements().removeClass('highlighted faded')
      }
    })

    return () => cy.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  // ── Switch layout ──────────────────────────────────────────────────────────

  const applyLayout = useCallback((name: LayoutName) => {
    setActiveLayout(name)
    cyRef.current?.layout(buildLayoutOptions(name)).run()
  }, [])

  // ── Zoom controls ──────────────────────────────────────────────────────────

  const zoomIn  = () => cyRef.current?.zoom({ level: Math.min(cyRef.current.zoom() * 1.3, 5), renderedPosition: { x: containerRef.current!.clientWidth / 2, y: containerRef.current!.clientHeight / 2 } })
  const zoomOut = () => cyRef.current?.zoom({ level: Math.max(cyRef.current.zoom() / 1.3, 0.1), renderedPosition: { x: containerRef.current!.clientWidth / 2, y: containerRef.current!.clientHeight / 2 } })
  const fitView = () => cyRef.current?.fit(undefined, 40)

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', width: '100%', height, background: 'var(--s-void)', borderRadius: 'var(--radius-m)', overflow: 'hidden', border: '1px solid var(--b-faint)' }}>

      {/* Canvas */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* ── Top toolbar ─────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 12, left: 12,
        display: 'flex', alignItems: 'center', gap: 6,
        zIndex: 10,
      }}>
        {/* Layout switcher */}
        <div style={{
          display: 'flex', background: 'rgba(10,13,19,0.88)', backdropFilter: 'blur(8px)',
          border: '1px solid var(--b-subtle)', borderRadius: 4, overflow: 'hidden',
        }}>
          {LAYOUTS.map(({ name, icon, label }) => (
            <button
              key={name}
              onClick={() => applyLayout(name)}
              title={`${label} layout`}
              style={{
                background:  activeLayout === name ? 'rgba(0,212,255,0.15)' : 'transparent',
                border:      'none',
                borderRight: '1px solid var(--b-subtle)',
                color:       activeLayout === name ? 'var(--t-cyan)' : 'var(--t-secondary)',
                fontFamily:  'var(--font-mono)',
                fontSize:    11,
                padding:     '5px 10px',
                cursor:      'pointer',
                display:     'flex', alignItems: 'center', gap: 5,
                transition:  'all 0.12s',
                whiteSpace:  'nowrap',
              }}
              onMouseEnter={e => { if (activeLayout !== name) (e.currentTarget as HTMLElement).style.color = 'var(--t-primary)' }}
              onMouseLeave={e => { if (activeLayout !== name) (e.currentTarget as HTMLElement).style.color = 'var(--t-secondary)' }}
            >
              <span style={{ fontSize: 13 }}>{icon}</span>
              <span style={{ letterSpacing: '0.05em' }}>{label.toUpperCase()}</span>
            </button>
          ))}
          {/* remove last border */}
          <style>{`.layout-btn:last-child { border-right: none !important; }`}</style>
        </div>

        {/* Stats */}
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center',
          background: 'rgba(10,13,19,0.88)', backdropFilter: 'blur(8px)',
          border: '1px solid var(--b-subtle)', borderRadius: 4,
          padding: '5px 10px',
        }}>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.08em' }}>
            <span style={{ color: 'var(--t-cyan)' }}>{nodeCount}</span> nodes
          </span>
          <span style={{ color: 'var(--b-visible)', fontSize: 10 }}>·</span>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.08em' }}>
            <span style={{ color: 'var(--t-green)' }}>{edgeCount}</span> edges
          </span>
        </div>
      </div>

      {/* ── Right zoom controls ──────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 12, right: 12,
        display: 'flex', flexDirection: 'column', gap: 4,
        zIndex: 10,
      }}>
        {[
          { label: '+', title: 'Zoom in',  onClick: zoomIn },
          { label: '−', title: 'Zoom out', onClick: zoomOut },
          { label: '⊡', title: 'Fit view', onClick: fitView },
        ].map(({ label, title, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            title={title}
            style={{
              width: 28, height: 28,
              background: 'rgba(10,13,19,0.88)', backdropFilter: 'blur(8px)',
              border: '1px solid var(--b-subtle)', borderRadius: 4,
              color: 'var(--t-secondary)', fontFamily: 'var(--font-mono)',
              fontSize: 14, cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--t-cyan)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,212,255,0.3)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--t-secondary)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--b-subtle)' }}
          >
            {label}
          </button>
        ))}
        {/* Zoom level display */}
        <div style={{
          width: 28, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(10,13,19,0.6)', borderRadius: 3,
          fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--t-muted)',
          letterSpacing: '0.04em',
        }}>
          {Math.round(zoom * 100)}%
        </div>
      </div>

      {/* ── Bottom legend ────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 12, left: 12,
        background: 'rgba(10,13,19,0.88)', backdropFilter: 'blur(8px)',
        border: '1px solid var(--b-subtle)', borderRadius: 4,
        padding: '7px 10px',
        display: 'flex', flexWrap: 'wrap', gap: '5px 12px',
        maxWidth: 380, zIndex: 10,
      }}>
        {Object.entries(NODE_COLORS)
          .filter(([k]) => k !== 'default')
          .map(([type, c]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c.bg, border: `1px solid ${c.border}`, display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--t-muted)', letterSpacing: '0.06em' }}>
                {type}
              </span>
            </div>
          ))}
      </div>

      {/* ── Empty state ──────────────────────────────────────────── */}
      {nodes.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', zIndex: 5, pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.15 }}>◈</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--t-muted)', letterSpacing: '0.1em' }}>
            NO GRAPH DATA
          </div>
        </div>
      )}
    </div>
  )
}

export default GraphViewer
