import React from 'react'
import { Drawer, Tag } from 'antd'
import type { GraphNode, GraphEdge } from '../../types/graph'

// ─── Types ────────────────────────────────────────────────────────────────────

type EdgeDetailPanelProps = {
  edge:      GraphEdge | null
  allNodes?: GraphNode[]
  onClose:   () => void
}

// ─── Edge type → colour mapping ───────────────────────────────────────────────

const EDGE_META: Record<string, { color: string; bg: string; symbol: string; label: string }> = {
  contains:      { color: '#4a5068', bg: 'rgba(74,80,104,0.08)',   symbol: '⊡', label: '包含' },
  depends_on:    { color: '#00d4ff', bg: 'rgba(0,212,255,0.08)',   symbol: '⤳', label: '依赖' },
  imports:       { color: '#b08eff', bg: 'rgba(176,142,255,0.08)', symbol: '⬆', label: '导入' },
  calls:         { color: '#00f084', bg: 'rgba(0,240,132,0.08)',   symbol: '→', label: '调用' },
  reads:         { color: '#ffc145', bg: 'rgba(255,193,69,0.08)',  symbol: '⇥', label: '读取' },
  writes:        { color: '#ff6b6b', bg: 'rgba(255,107,107,0.08)', symbol: '⇤', label: '写入' },
  produces:      { color: '#ffcc44', bg: 'rgba(255,204,68,0.08)',  symbol: '⚡', label: '生产' },
  consumes:      { color: '#ff9955', bg: 'rgba(255,153,85,0.08)',  symbol: '⬇', label: '消费' },
  publishes:     { color: '#44aaff', bg: 'rgba(68,170,255,0.08)',  symbol: '📣', label: '发布' },
  subscribes:    { color: '#7ed957', bg: 'rgba(126,217,87,0.08)',  symbol: '📥', label: '订阅' },
  async_calls:   { color: '#00d4ff', bg: 'rgba(0,212,255,0.08)',   symbol: '⤳', label: '异步调用' },
  handles:       { color: '#b08eff', bg: 'rgba(176,142,255,0.08)', symbol: '✋', label: '处理' },
  implements:    { color: '#00f084', bg: 'rgba(0,240,132,0.08)',   symbol: '✓', label: '实现' },
  belongs_to:    { color: '#888899', bg: 'rgba(136,136,153,0.08)', symbol: '∈', label: '属于' },
  flow_to:       { color: '#00d4ff', bg: 'rgba(0,212,255,0.08)',   symbol: '↬', label: '流向' },
  queries:       { color: '#b08eff', bg: 'rgba(176,142,255,0.08)', symbol: '❓', label: '查询' },
  transforms:    { color: '#ffc145', bg: 'rgba(255,193,69,0.08)',  symbol: '⟳', label: '转换' },
  triggers:      { color: '#ff6b6b', bg: 'rgba(255,107,107,0.08)', symbol: '⚡', label: '触发' },
  default:       { color: '#4a5068', bg: 'rgba(74,80,104,0.08)',   symbol: '—', label: '关联' },
}

function getEdgeMeta(type: string) {
  return EDGE_META[type] ?? EDGE_META.default
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    fontFamily:    'var(--font-mono)',
    fontSize:      9,
    letterSpacing: '0.12em',
    color:         'var(--t-muted)',
    marginBottom:  8,
    textTransform: 'uppercase',
  }}>
    {children}
  </div>
)

const Divider = () => (
  <div style={{ height: 1, background: 'var(--b-faint)', margin: '16px 0' }} />
)

// ─── EdgeDetailPanel ──────────────────────────────────────────────────────────

const EdgeDetailPanel: React.FC<EdgeDetailPanelProps> = ({ edge, allNodes = [], onClose }) => {
  const meta = edge ? getEdgeMeta(edge.type) : EDGE_META.default

  // Find source and target nodes
  const sourceNode = edge ? allNodes.find(n => n.id === edge.source) : null
  const targetNode = edge ? allNodes.find(n => n.id === edge.target) : null

  // Get edge properties
  const properties = edge?.properties ?? {}
  const propEntries = Object.entries(properties).filter(([key]) => key !== 'id')

  return (
    <Drawer
      open={!!edge}
      onClose={onClose}
      placement="right"
      width={320}
      closeIcon={
        <span style={{ color: 'var(--t-secondary)', fontFamily: 'var(--font-mono)', fontSize: 14 }}>✕</span>
      }
      styles={{
        header: {
          background:   'var(--s-float)',
          borderBottom: '1px solid var(--b-faint)',
          padding:      '14px 18px',
        },
        body: {
          background: 'var(--s-float)',
          padding:    '18px',
          overflowY:  'auto',
        },
        mask: {
          background: 'rgba(7,9,13,0.55)',
        },
      }}
      title={
        edge ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Type badge */}
            <div style={{
              width:          32,
              height:         32,
              borderRadius:   6,
              background:     meta.bg,
              border:         `1px solid ${meta.color}`,
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              fontSize:       15,
              color:          meta.color,
              flexShrink:     0,
            }}>
              {meta.symbol}
            </div>
            <div>
              <div style={{
                fontFamily:    'var(--font-ui)',
                fontSize:      13,
                fontWeight:    600,
                color:         'var(--t-primary)',
                letterSpacing: '0.02em',
                lineHeight:    1.2,
              }}>
                {meta.label}
              </div>
              <div style={{
                fontFamily:    'var(--font-mono)',
                fontSize:      9,
                color:         meta.color,
                letterSpacing: '0.1em',
                marginTop:     2,
              }}>
                {edge.type.toUpperCase()}
              </div>
            </div>
          </div>
        ) : null
      }
    >
      {edge && (
        <>
          {/* ── Edge ID ──────────────────────────────────────── */}
          <SectionLabel>边 ID</SectionLabel>
          <div style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      10,
            color:         'var(--t-secondary)',
            background:    'var(--s-raised)',
            border:        '1px solid var(--b-faint)',
            borderRadius:  4,
            padding:       '7px 10px',
            wordBreak:     'break-all',
            letterSpacing: '0.02em',
          }}>
            {edge.source} → {edge.target}
          </div>

          {/* ── Source Node ───────────────────────────────────── */}
          <Divider />
          <SectionLabel>源节点</SectionLabel>
          {sourceNode ? (
            <NodePreview node={sourceNode} />
          ) : (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize:   10,
              color:      'var(--t-muted)',
              background: 'var(--s-raised)',
              border:     '1px solid var(--b-faint)',
              borderRadius: 4,
              padding:    '8px 10px',
            }}>
              {edge.source}
            </div>
          )}

          {/* ── Target Node ───────────────────────────────────── */}
          <Divider />
          <SectionLabel>目标节点</SectionLabel>
          {targetNode ? (
            <NodePreview node={targetNode} />
          ) : (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize:   10,
              color:      'var(--t-muted)',
              background: 'var(--s-raised)',
              border:     '1px solid var(--b-faint)',
              borderRadius: 4,
              padding:    '8px 10px',
            }}>
              {edge.target}
            </div>
          )}

          {/* ── Properties ───────────────────────────────────── */}
          {propEntries.length > 0 && (
            <>
              <Divider />
              <SectionLabel>属性</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {propEntries.map(([key, val]) => (
                  <div key={key} style={{
                    display:       'grid',
                    gridTemplateColumns: '100px 1fr',
                    gap:           8,
                    alignItems:    'start',
                    background:    'var(--s-raised)',
                    border:        '1px solid var(--b-faint)',
                    borderRadius:  4,
                    padding:       '6px 10px',
                  }}>
                    <span style={{
                      fontFamily:    'var(--font-mono)',
                      fontSize:      9,
                      color:         'var(--t-muted)',
                      letterSpacing: '0.06em',
                      paddingTop:    1,
                      overflow:      'hidden',
                      textOverflow:  'ellipsis',
                      whiteSpace:    'nowrap',
                    }}>
                      {key}
                    </span>
                    <span style={{
                      fontFamily:    'var(--font-mono)',
                      fontSize:      10,
                      color:         'var(--t-primary)',
                      wordBreak:     'break-all',
                    }}>
                      {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Empty state */}
          {propEntries.length === 0 && (
            <>
              <Divider />
              <div style={{
                textAlign:     'center',
                padding:       '20px 0',
                fontFamily:    'var(--font-mono)',
                fontSize:      10,
                color:         'var(--t-muted)',
                letterSpacing: '0.08em',
              }}>
                暂无属性信息
              </div>
            </>
          )}
        </>
      )}
    </Drawer>
  )
}

// ─── NodePreview ─────────────────────────────────────────────────────────────

const NodePreview: React.FC<{ node: GraphNode }> = ({ node }) => {
  // Node type color mapping
  const NODE_COLORS: Record<string, string> = {
    repository:   '#00d4ff',
    module:       '#b08eff',
    file:         '#00f084',
    class:        '#ffc145',
    function:     '#ff6b6b',
    service:      '#7ed957',
    database:     '#9d7dff',
    api:          '#ff6b6b',
    apiendpoint:  '#00d4ff',
    datasource:   '#b08eff',
    table:        '#b08eff',
    topic:        '#ff6b6b',
    default:      '#4a5068',
  }

  const color = NODE_COLORS[node.type.toLowerCase()] ?? NODE_COLORS.default

  return (
    <div style={{
      display:       'flex',
      alignItems:    'center',
      gap:           8,
      background:    'var(--s-raised)',
      border:        '1px solid var(--b-faint)',
      borderRadius:  4,
      padding:       '8px 10px',
    }}>
      {/* Type dot */}
      <span style={{
        width:       8,
        height:      8,
        borderRadius: '50%',
        background:  color,
        flexShrink:  0,
      }} />

      {/* Label */}
      <span style={{
        fontFamily:   'var(--font-mono)',
        fontSize:     10,
        color:        'var(--t-primary)',
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        whiteSpace:   'nowrap',
        flex:         1,
      }}>
        {node.label}
      </span>

      {/* Type tag */}
      <Tag
        style={{
          fontFamily:    'var(--font-mono)',
          fontSize:      8,
          color:         color,
          background:    `${color}18`,
          border:        `1px solid ${color}40`,
          borderRadius:  3,
          padding:       '0 4px',
          margin:        0,
          letterSpacing: '0.04em',
        }}
      >
        {node.type.toUpperCase()}
      </Tag>
    </div>
  )
}

export default EdgeDetailPanel
