import React, { useCallback } from 'react'
import { Button, Divider, Tag, Tooltip } from 'antd'
import {
  CloseOutlined,
  ExpandAltOutlined,
  LoadingOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons'
import {
  useGraphEngineStore,
  selectSelectedNode,
} from '../../graph-engine/store'
import { getNodeTypeColor, getEdgeTypeColor, getNodeTypeTagColor } from '../../theme'
import type { EngineGraphNode, EngineGraphEdge } from '../../graph-engine/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type GraphSidePanelProps = {
  onExpandNode: (nodeId: string) => Promise<void>
  onClose?: () => void
}

// ─── GraphSidePanel ───────────────────────────────────────────────────────────

export const GraphSidePanel: React.FC<GraphSidePanelProps> = ({
  onExpandNode,
  onClose,
}) => {
  const node          = useGraphEngineStore(selectSelectedNode)
  const edges         = useGraphEngineStore(s => s.edges)
  const nodes         = useGraphEngineStore(s => s.nodes)
  const expandingId   = useGraphEngineStore(s => s.loading.expandingId)
  const setSelected   = useGraphEngineStore(s => s.setSelectedNode)

  const isExpanding = node ? expandingId === node.id : false

  const handleClose = useCallback(() => {
    setSelected(null)
    onClose?.()
  }, [setSelected, onClose])

  const handleExpand = useCallback(() => {
    if (node) onExpandNode(node.id).catch(() => undefined)
  }, [node, onExpandNode])

  // No selected node — render empty placeholder so layout space is preserved
  if (!node) {
    return (
      <div style={panelStyle}>
        <EmptyPanel />
      </div>
    )
  }

  const color = getNodeTypeColor(node.type)
  const props = getDisplayProperties(node)
  const { incoming, outgoing } = getConnectedEdges(node.id, edges, nodes)

  return (
    <div style={panelStyle}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color.primary,
            boxShadow: `0 0 8px ${color.primary}`,
            flexShrink: 0,
          }} />
          <Tag
            color={getNodeTypeTagColor(node.type)}
            style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 9, letterSpacing: '0.06em', margin: 0 }}
          >
            {node.type}
          </Tag>
        </div>
        <button onClick={handleClose} style={closeBtnStyle} title="Close panel">
          <CloseOutlined style={{ fontSize: 11 }} />
        </button>
      </div>

      {/* ── Node label ──────────────────────────────────────────────── */}
      <div style={{ padding: '10px 14px 0' }}>
        <div style={nodeLabelStyle}>{node.label}</div>
        {node.id !== node.label && (
          <div style={nodeIdStyle} title={node.id}>
            {node.id.length > 52 ? `${node.id.slice(0, 52)}…` : node.id}
          </div>
        )}
      </div>

      {/* ── Metrics ─────────────────────────────────────────────────── */}
      <div style={metricsRowStyle}>
        <MetricBadge label="DEGREE"   value={node.degree}              color="#9ba8c8" />
        <MetricBadge label="PAGERANK" value={node.pageRank.toFixed(4)} color="#00d4ff" />
        <MetricBadge
          label="STATUS"
          value={node.expanded ? 'EXPANDED' : node.hasChildren ? 'HAS CHILDREN' : 'LEAF'}
          color={node.expanded ? '#00f084' : node.hasChildren ? '#ffc145' : '#6b7a9d'}
        />
      </div>

      <Divider style={{ margin: '10px 0', borderColor: 'rgba(255,255,255,0.05)' }} />

      <div style={scrollAreaStyle}>
        {/* ── Expand button ─────────────────────────────────────────── */}
        {node.hasChildren && (
          <div style={{ padding: '0 14px 12px' }}>
            <Tooltip title={node.expanded ? 'Children already loaded' : 'Load child nodes'}>
              <Button
                block
                size="small"
                icon={isExpanding ? <LoadingOutlined spin /> : <ExpandAltOutlined />}
                onClick={handleExpand}
                disabled={node.expanded || isExpanding}
                style={{
                  background:  node.expanded ? 'transparent' : 'rgba(0,240,132,0.08)',
                  border:      `1px solid ${node.expanded ? 'rgba(255,255,255,0.08)' : 'rgba(0,240,132,0.3)'}`,
                  color:       node.expanded ? '#6b7a9d' : '#00f084',
                  fontFamily:  '"IBM Plex Mono", monospace',
                  fontSize:     11,
                  letterSpacing: '0.06em',
                }}
              >
                {node.expanded ? 'CHILDREN LOADED' : isExpanding ? 'EXPANDING…' : 'EXPAND NODE'}
              </Button>
            </Tooltip>
          </div>
        )}

        {/* ── Properties ────────────────────────────────────────────── */}
        {props.length > 0 && (
          <section style={sectionStyle}>
            <SectionHeader icon="⊟" label="PROPERTIES" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
              {props.map(({ key, value }) => (
                <PropertyRow key={key} propKey={key} value={value} />
              ))}
            </div>
          </section>
        )}

        {/* ── Outgoing edges ────────────────────────────────────────── */}
        {outgoing.length > 0 && (
          <section style={sectionStyle}>
            <SectionHeader icon="→" label={`CALLS / USES  (${outgoing.length})`} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
              {outgoing.slice(0, 20).map(({ edge, target }) => (
                <EdgeRow key={edge.id} edge={edge} peer={target} direction="out" />
              ))}
              {outgoing.length > 20 && (
                <div style={moreStyle}>+{outgoing.length - 20} more</div>
              )}
            </div>
          </section>
        )}

        {/* ── Incoming edges ────────────────────────────────────────── */}
        {incoming.length > 0 && (
          <section style={sectionStyle}>
            <SectionHeader icon="←" label={`CALLERS / DEPS  (${incoming.length})`} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
              {incoming.slice(0, 20).map(({ edge, peer }) => (
                <EdgeRow key={edge.id} edge={edge} peer={peer} direction="in" />
              ))}
              {incoming.length > 20 && (
                <div style={moreStyle}>+{incoming.length - 20} more</div>
              )}
            </div>
          </section>
        )}

        {props.length === 0 && outgoing.length === 0 && incoming.length === 0 && (
          <div style={emptyDetailStyle}>
            <NodeIndexOutlined style={{ fontSize: 24, opacity: 0.2 }} />
            <span>No additional details</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const EmptyPanel: React.FC = () => (
  <div style={{
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    height:          '100%',
    gap:             10,
    opacity:         0.35,
  }}>
    <NodeIndexOutlined style={{ fontSize: 28, color: '#6b7a9d' }} />
    <span style={{
      fontFamily:    '"IBM Plex Mono", monospace',
      fontSize:       10,
      color:         '#6b7a9d',
      letterSpacing: '0.1em',
    }}>
      SELECT A NODE
    </span>
  </div>
)

const SectionHeader: React.FC<{ icon: string; label: string }> = ({ icon, label }) => (
  <div style={{
    display:       'flex',
    alignItems:    'center',
    gap:            6,
    marginBottom:   4,
  }}>
    <span style={{ fontSize: 10, color: '#3a5a6a' }}>{icon}</span>
    <span style={{
      fontFamily:    '"IBM Plex Mono", monospace',
      fontSize:       9,
      color:         '#3a5a6a',
      letterSpacing: '0.12em',
      fontWeight:     600,
    }}>
      {label}
    </span>
  </div>
)

const MetricBadge: React.FC<{ label: string; value: string | number; color: string }> = ({
  label, value, color,
}) => (
  <div style={{
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    gap:             2,
    flex:            1,
    padding:        '6px 4px',
    background:     'rgba(255,255,255,0.02)',
    borderRadius:    4,
  }}>
    <span style={{
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize:    11,
      fontWeight:   700,
      color,
      lineHeight:   1,
    }}>
      {value}
    </span>
    <span style={{
      fontFamily:    '"IBM Plex Mono", monospace',
      fontSize:       8,
      color:         '#3a5a6a',
      letterSpacing: '0.1em',
    }}>
      {label}
    </span>
  </div>
)

const PropertyRow: React.FC<{ propKey: string; value: string }> = ({ propKey, value }) => (
  <div style={{
    display:      'flex',
    gap:           8,
    padding:      '3px 0',
    alignItems:   'flex-start',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
  }}>
    <span style={{
      fontFamily:    '"IBM Plex Mono", monospace',
      fontSize:       10,
      color:         '#6b7a9d',
      flexShrink:     0,
      minWidth:       80,
      maxWidth:       90,
      overflow:       'hidden',
      textOverflow:  'ellipsis',
      whiteSpace:    'nowrap',
    }}>
      {propKey}
    </span>
    <span style={{
      fontFamily:    '"IBM Plex Mono", monospace',
      fontSize:       10,
      color:         '#c8d4e8',
      wordBreak:     'break-word',
      flex:           1,
    }}>
      {value}
    </span>
  </div>
)

type EdgeEntry = { edge: EngineGraphEdge; peer: EngineGraphNode | null }

const EdgeRow: React.FC<{
  edge: EngineGraphEdge
  peer: EngineGraphNode | null
  direction: 'in' | 'out'
}> = ({ edge, peer, direction }) => {
  const edgeColor = getEdgeTypeColor(edge.type)
  const peerColor = peer ? getNodeTypeColor(peer.type) : null

  return (
    <div style={{
      display:       'flex',
      alignItems:    'center',
      gap:            6,
      padding:       '3px 0',
      borderBottom:  '1px solid rgba(255,255,255,0.03)',
    }}>
      <span style={{
        fontFamily:    '"IBM Plex Mono", monospace',
        fontSize:       9,
        color:          edgeColor,
        background:    `${edgeColor}18`,
        border:        `1px solid ${edgeColor}30`,
        borderRadius:   3,
        padding:       '1px 5px',
        flexShrink:     0,
        letterSpacing: '0.04em',
      }}>
        {edge.type}
      </span>

      <span style={{ fontSize: 9, color: '#3a5a6a', flexShrink: 0 }}>
        {direction === 'out' ? '→' : '←'}
      </span>

      {peerColor && (
        <span style={{
          width:        5,
          height:       5,
          borderRadius: '50%',
          background:   peerColor.primary,
          flexShrink:   0,
        }} />
      )}

      <span style={{
        fontFamily:   '"IBM Plex Mono", monospace',
        fontSize:      10,
        color:        '#9ba8c8',
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        whiteSpace:   'nowrap',
        flex:          1,
      }}>
        {peer?.label ?? (direction === 'out' ? edge.target : edge.source)}
      </span>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDisplayProperties(node: EngineGraphNode): { key: string; value: string }[] {
  const skip = new Set(['id', 'name', 'label', 'type'])
  return Object.entries(node.properties)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => ({
      key: k,
      value: v === null || v === undefined
        ? '—'
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v),
    }))
    .slice(0, 30)
}

function getConnectedEdges(
  nodeId: string,
  edges:  Map<string, EngineGraphEdge>,
  nodes:  Map<string, EngineGraphNode>,
): { incoming: { edge: EngineGraphEdge; peer: EngineGraphNode | null }[]; outgoing: EdgeEntry[] } {
  const incoming: { edge: EngineGraphEdge; peer: EngineGraphNode | null }[] = []
  const outgoing: EdgeEntry[] = []

  for (const edge of edges.values()) {
    if (edge.target === nodeId) {
      incoming.push({ edge, peer: nodes.get(edge.source) ?? null })
    } else if (edge.source === nodeId) {
      outgoing.push({ edge, peer: nodes.get(edge.target) ?? null })
    }
  }

  return { incoming, outgoing }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  width:          300,
  height:         '100%',
  background:     '#0e1520',
  borderLeft:     '1px solid rgba(255,255,255,0.05)',
  display:        'flex',
  flexDirection:  'column',
  flexShrink:      0,
  overflow:       'hidden',
}

const headerStyle: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  gap:             8,
  padding:        '10px 14px',
  borderBottom:   '1px solid rgba(255,255,255,0.05)',
  background:     'rgba(0,0,0,0.2)',
  flexShrink:      0,
}

const closeBtnStyle: React.CSSProperties = {
  background:     'none',
  border:         'none',
  cursor:         'pointer',
  color:          '#6b7a9d',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  padding:         4,
  borderRadius:    3,
  flexShrink:      0,
}

const nodeLabelStyle: React.CSSProperties = {
  fontFamily:    '"IBM Plex Mono", monospace',
  fontSize:       13,
  fontWeight:     600,
  color:         '#e8ecf8',
  wordBreak:     'break-word',
  lineHeight:     1.4,
}

const nodeIdStyle: React.CSSProperties = {
  fontFamily:    '"IBM Plex Mono", monospace',
  fontSize:       9,
  color:         '#4a5a6a',
  marginTop:      3,
  letterSpacing: '0.04em',
  overflow:      'hidden',
  textOverflow:  'ellipsis',
  whiteSpace:    'nowrap',
}

const metricsRowStyle: React.CSSProperties = {
  display:  'flex',
  gap:       6,
  padding:  '10px 14px 0',
  flexShrink: 0,
}

const scrollAreaStyle: React.CSSProperties = {
  flex:       1,
  overflowY: 'auto',
  padding:   '0 0 16px',
}

const sectionStyle: React.CSSProperties = {
  padding:      '10px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
}

const emptyDetailStyle: React.CSSProperties = {
  display:        'flex',
  flexDirection:  'column',
  alignItems:     'center',
  gap:             8,
  padding:        '32px 14px',
  fontFamily:     '"IBM Plex Mono", monospace',
  fontSize:        10,
  color:          '#4a5a6a',
  letterSpacing:  '0.08em',
}

const moreStyle: React.CSSProperties = {
  fontFamily:    '"IBM Plex Mono", monospace',
  fontSize:       9,
  color:         '#3a4a5a',
  padding:       '3px 0',
  letterSpacing: '0.06em',
}
