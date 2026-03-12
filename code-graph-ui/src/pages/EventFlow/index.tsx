import React, { useEffect, useState, useMemo } from 'react'
import { Alert } from 'antd'
import { useGraphStore } from '../../store/graphStore'
import { useRepoStore } from '../../store/repoStore'
import GraphViewer, { type LayoutName } from '../../components/GraphViewer'
import NodeDetailPanel from '../../components/NodeDetailPanel'
import type { GraphNode } from '../../types/graph'

// ─── Node type filter config ──────────────────────────────────────────────────

const NODE_FILTERS = [
  { type: 'all',      label: 'ALL',      color: '#6e7a99' },
  { type: 'Producer', label: 'PRODUCER', color: '#ffc145' },
  { type: 'Event',    label: 'EVENT',    color: '#00d4ff' },
  { type: 'Topic',    label: 'TOPIC',    color: '#b08eff' },
  { type: 'Consumer', label: 'CONSUMER', color: '#00f084' },
]

const LAYOUTS: { name: LayoutName; label: string; icon: string }[] = [
  { name: 'force',  label: 'Force',  icon: '⊛' },
  { name: 'dagre',  label: 'Dagre',  icon: '⇣' },
  { name: 'grid',   label: 'Grid',   icon: '⊞' },
]

// ─── Filter Chip ──────────────────────────────────────────────────────────────

type FilterChipProps = {
  label:    string
  color:    string
  active:   boolean
  count?:   number
  onClick:  () => void
}

const FilterChip: React.FC<FilterChipProps> = ({ label, color, active, count, onClick }) => (
  <button
    onClick={onClick}
    style={{
      display:       'inline-flex',
      alignItems:    'center',
      gap:           6,
      padding:       '5px 12px',
      borderRadius:  3,
      border:        `1px solid ${active ? color : 'var(--b-faint)'}`,
      background:    active ? `${color}18` : 'var(--s-raised)',
      cursor:        'pointer',
      transition:    'all 0.15s',
      fontFamily:    'var(--font-mono)',
      fontSize:      9,
      letterSpacing: '0.1em',
      color:         active ? color : 'var(--t-muted)',
      whiteSpace:    'nowrap',
    }}
    onMouseEnter={e => {
      if (!active) {
        e.currentTarget.style.borderColor = `${color}60`
        e.currentTarget.style.color = color
      }
    }}
    onMouseLeave={e => {
      if (!active) {
        e.currentTarget.style.borderColor = 'var(--b-faint)'
        e.currentTarget.style.color = 'var(--t-muted)'
      }
    }}
  >
    {active && (
      <span style={{
        width:        5,
        height:       5,
        borderRadius: '50%',
        background:   color,
        flexShrink:   0,
      }} />
    )}
    {label}
    {count !== undefined && (
      <span style={{
        background:    active ? `${color}30` : 'var(--s-float)',
        border:        `1px solid ${active ? `${color}40` : 'var(--b-faint)'}`,
        borderRadius:  2,
        padding:       '0 4px',
        fontSize:      8,
        color:         active ? color : 'var(--t-muted)',
        minWidth:      16,
        textAlign:     'center',
      }}>
        {count}
      </span>
    )}
  </button>
)

// ─── Layout Button ────────────────────────────────────────────────────────────

type LayoutBtnProps = {
  icon:    string
  label:   string
  active:  boolean
  onClick: () => void
}

const LayoutBtn: React.FC<LayoutBtnProps> = ({ icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    style={{
      display:       'inline-flex',
      alignItems:    'center',
      gap:           5,
      padding:       '5px 10px',
      borderRadius:  3,
      border:        `1px solid ${active ? 'rgba(255,193,69,0.5)' : 'var(--b-faint)'}`,
      background:    active ? 'rgba(255,193,69,0.1)' : 'var(--s-raised)',
      cursor:        'pointer',
      transition:    'all 0.15s',
      fontFamily:    'var(--font-mono)',
      fontSize:      10,
      color:         active ? '#ffc145' : 'var(--t-muted)',
    }}
    onMouseEnter={e => {
      if (!active) {
        e.currentTarget.style.borderColor = 'rgba(255,193,69,0.3)'
        e.currentTarget.style.color = 'var(--t-secondary)'
      }
    }}
    onMouseLeave={e => {
      if (!active) {
        e.currentTarget.style.borderColor = 'var(--b-faint)'
        e.currentTarget.style.color = 'var(--t-muted)'
      }
    }}
  >
    <span style={{ fontSize: 12 }}>{icon}</span>
    {label}
  </button>
)

// ─── EventFlow Page ───────────────────────────────────────────────────────────

const EventFlow: React.FC = () => {
  const { eventGraph, loadEvents, setSelectedNode } = useGraphStore()
  const { activeRepo } = useRepoStore()
  const [panelNode, setPanelNode] = useState<GraphNode | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [layout, setLayout] = useState<LayoutName>('force')

  useEffect(() => {
    if (activeRepo?.graphId) {
      loadEvents(activeRepo.graphId)
    }
  }, [activeRepo?.graphId])

  const allNodes = eventGraph.data?.nodes ?? []
  const allEdges = eventGraph.data?.edges ?? []

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    allNodes.forEach(n => {
      counts[n.type] = (counts[n.type] ?? 0) + 1
    })
    return counts
  }, [allNodes])

  const { filteredNodes, filteredEdges } = useMemo(() => {
    if (activeFilter === 'all') return { filteredNodes: allNodes, filteredEdges: allEdges }

    const filtered = allNodes.filter(n => n.type === activeFilter)
    const ids = new Set(filtered.map(n => n.id))
    const edges = allEdges.filter(e => ids.has(e.source) && ids.has(e.target))

    return { filteredNodes: filtered, filteredEdges: edges }
  }, [allNodes, allEdges, activeFilter])

  const handleNodeClick = (node: GraphNode) => {
    setPanelNode(node)
    setSelectedNode(node)
  }

  const handlePanelClose = () => {
    setPanelNode(null)
    setSelectedNode(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>

      {/* Page heading */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        flexShrink:     0,
        marginBottom:   14,
      }}>
        <div>
          <div style={{
            fontSize:      9,
            fontFamily:    'var(--font-mono)',
            color:         'var(--t-muted)',
            letterSpacing: '0.15em',
            marginBottom:  4,
          }}>
            SYS / EVENT FLOW
          </div>
          <h2 style={{
            margin:        0,
            fontSize:      22,
            fontWeight:    700,
            color:         'var(--t-primary)',
            fontFamily:    'var(--font-ui)',
            letterSpacing: '-0.01em',
          }}>
            Event Flow
          </h2>
        </div>

        {eventGraph.data && (
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { label: 'nodes', value: filteredNodes.length, total: allNodes.length, color: '#ffc145' },
              { label: 'edges', value: filteredEdges.length, total: allEdges.length, color: '#00f084' },
            ].map(({ label, value, total, color }) => (
              <div key={label} style={{
                fontFamily:    'var(--font-mono)',
                fontSize:      11,
                color:         'var(--t-muted)',
                background:    'var(--s-raised)',
                border:        '1px solid var(--b-faint)',
                borderRadius:  4,
                padding:       '4px 10px',
                letterSpacing: '0.06em',
              }}>
                <span style={{ color }}>{value}</span>
                {value !== total && (
                  <span style={{ color: 'var(--t-muted)', fontSize: 9 }}>/{total}</span>
                )}
                {' '}{label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toolbar */}
      {eventGraph.data && (
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          flexShrink:     0,
          marginBottom:   12,
          gap:            12,
          flexWrap:       'wrap',
        }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {NODE_FILTERS.map(f => {
              const count = f.type === 'all' ? allNodes.length : (typeCounts[f.type] ?? 0)
              if (f.type !== 'all' && count === 0) return null
              return (
                <FilterChip
                  key={f.type}
                  label={f.label}
                  color={f.color}
                  active={activeFilter === f.type}
                  count={count}
                  onClick={() => setActiveFilter(f.type)}
                />
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            {LAYOUTS.map(l => (
              <LayoutBtn
                key={l.name}
                icon={l.icon}
                label={l.label}
                active={layout === l.name}
                onClick={() => setLayout(l.name)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Alerts */}
      {!activeRepo && (
        <Alert
          type="info"
          message="Select a repository from the top bar to visualize event flow"
          showIcon
          style={{ borderRadius: 4, flexShrink: 0 }}
        />
      )}

      {eventGraph.error && (
        <Alert
          type="error"
          message={eventGraph.error}
          showIcon
          style={{ borderRadius: 4, flexShrink: 0 }}
        />
      )}

      {/* Loading */}
      {eventGraph.loading && (
        <div style={{
          flex:           1,
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            16,
          background:     'var(--s-void)',
          border:         '1px solid var(--b-faint)',
          borderRadius:   'var(--radius-m)',
        }}>
          <span style={{
            fontSize:  36,
            color:     'var(--t-muted)',
            animation: 'pulse 1.5s ease-in-out infinite',
            display:   'inline-block',
          }}>
            ⚡
          </span>
          <div style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      11,
            color:         'var(--t-muted)',
            letterSpacing: '0.1em',
          }}>
            LOADING EVENT GRAPH…
          </div>
        </div>
      )}

      {/* Graph canvas */}
      {!eventGraph.loading && eventGraph.data && (
        <div style={{
          flex:         1,
          minHeight:    0,
          borderRadius: 'var(--radius-m)',
          overflow:     'hidden',
          border:       '1px solid var(--b-faint)',
        }}>
          <GraphViewer
            nodes={filteredNodes}
            edges={filteredEdges}
            layout={layout}
            onNodeClick={handleNodeClick}
            height="100%"
          />
        </div>
      )}

      {/* Empty state */}
      {!eventGraph.loading && !eventGraph.data && activeRepo && !eventGraph.error && (
        <div style={{
          flex:           1,
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            12,
          background:     'var(--s-void)',
          border:         '1px solid var(--b-faint)',
          borderRadius:   'var(--radius-m)',
        }}>
          <div style={{ fontSize: 36, opacity: 0.12 }}>⚡</div>
          <div style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      11,
            color:         'var(--t-muted)',
            letterSpacing: '0.1em',
          }}>
            NO EVENT DATA
          </div>
        </div>
      )}

      {/* Node detail drawer */}
      <NodeDetailPanel
        node={panelNode}
        edges={allEdges}
        allNodes={allNodes}
        onClose={handlePanelClose}
      />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </div>
  )
}

export default EventFlow
