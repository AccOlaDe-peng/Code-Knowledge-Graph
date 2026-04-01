import React, { useMemo } from 'react'
import { Drawer } from 'antd'
import type { GraphNode, GraphEdge } from '../../../types/graph'

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeDetailPanelProps = {
  node:     GraphNode | null
  edges?:   GraphEdge[]
  allNodes?: GraphNode[]
  onClose:  () => void
}

// ─── Node type → colour mapping (mirrors GraphViewer palette) ─────────────────

const TYPE_META: Record<string, { color: string; bg: string; symbol: string }> = {
  Module:         { color: '#00d4ff', bg: 'rgba(0,212,255,0.08)',   symbol: '◫' },
  Component:      { color: '#00f084', bg: 'rgba(0,240,132,0.08)',   symbol: '⬡' },
  Function:       { color: '#ffc145', bg: 'rgba(255,193,69,0.08)',  symbol: 'ƒ' },
  Class:          { color: '#ff66cc', bg: 'rgba(255,102,204,0.08)', symbol: '⊡' },  // Magenta
  Service:        { color: '#7ed957', bg: 'rgba(126,217,87,0.08)',  symbol: '◎' },
  Database:       { color: '#ff66cc', bg: 'rgba(255,102,204,0.08)', symbol: '⊞' },  // Magenta
  API:            { color: '#ff6b6b', bg: 'rgba(255,107,107,0.08)', symbol: '⇌' },
  Event:          { color: '#ffcc44', bg: 'rgba(255,204,68,0.08)',  symbol: '⚡' },
  Cluster:        { color: '#44aaff', bg: 'rgba(68,170,255,0.08)',  symbol: '⊕' },
  Infrastructure: { color: '#88aacc', bg: 'rgba(136,170,204,0.08)', symbol: '⚙' },  // Silver
  // AI 优先流水线新增节点类型
  Entity:         { color: '#ff66cc', bg: 'rgba(255,102,204,0.08)', symbol: '▢' },  // Magenta
  Table:          { color: '#ff66cc', bg: 'rgba(255,102,204,0.08)', symbol: '⊞' },  // Magenta
  Field:          { color: '#00ccaa', bg: 'rgba(0,204,170,0.08)',   symbol: 'Field' },  // Teal
  Flow:           { color: '#ffcc44', bg: 'rgba(255,204,68,0.08)',  symbol: '⟳' },
  FlowNode:       { color: '#88dd88', bg: 'rgba(136,221,136,0.08)', symbol: '◉' },
  default:        { color: '#88aacc', bg: 'rgba(136,170,204,0.08)', symbol: '●' },  // Silver
}

const EDGE_COLORS: Record<string, string> = {
  calls:       '#00f084',
  depends_on:  '#00d4ff',
  imports:     '#ff66cc',     // Magenta
  contains:    '#88aacc',     // Silver
  reads:       '#ffc145',
  writes:      '#ff6b6b',
  produces:    '#ffcc44',
  consumes:    '#ff9955',
  publishes:   '#44aaff',
  subscribes:  '#7ed957',
  // AI 优先流水线新增边类型
  maps_to:      '#ff66cc',    // Magenta
  has_field:    '#99bbdd',    // Silver
  one_to_one:   '#00f084',
  one_to_many:  '#00f084',
  many_to_one:  '#00f084',
  many_to_many: '#ffcc44',
  flow_to:      '#00d4ff',
}

function getTypeMeta(type: string) {
  return TYPE_META[type] ?? TYPE_META.default
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
  <div style={{ height: 1, background: 'var(--b-faint)', margin: '18px 0' }} />
)

type RelatedNode = {
  node:     GraphNode
  edgeType: string
  dir:      'in' | 'out'
}

// ─── Entity Details Component ──────────────────────────────────────────────────

const EntityDetails: React.FC<{ node: GraphNode }> = ({ node }) => {
  const props = node.properties ?? {}
  const importanceScore = typeof props.importance_score === 'number' ? props.importance_score : 5
  const importanceColor = importanceScore >= 8 ? '#00f084' : importanceScore >= 5 ? '#ffc145' : '#ff6b6b'

  return (
    <>
      {/* Table name */}
      {typeof props.table_name === 'string' && (
        <>
          <SectionLabel>映射表名</SectionLabel>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--t-primary)',
            background: 'var(--s-raised)',
            border: '1px solid var(--b-faint)',
            borderRadius: 4,
            padding: '8px 12px',
          }}>
            {props.table_name}
          </div>
        </>
      )}

      {/* Primary key */}
      {typeof props.primary_key === 'string' && (
        <>
          <Divider />
          <SectionLabel>主键字段</SectionLabel>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: '#00d4ff',
            background: 'rgba(0,212,255,0.08)',
            border: '1px solid rgba(0,212,255,0.2)',
            borderRadius: 4,
            padding: '6px 10px',
          }}>
            🔑 {props.primary_key}
          </div>
        </>
      )}

      {/* Core fields */}
      {Array.isArray(props.core_fields) && props.core_fields.length > 0 && (
        <>
          <Divider />
          <SectionLabel>核心字段</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {props.core_fields.map((f, i) => (
              <span key={i} style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--t-secondary)',
                background: 'var(--s-raised)',
                border: '1px solid var(--b-faint)',
                borderRadius: 3,
                padding: '3px 8px',
              }}>
                {String(f)}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Importance score */}
      <Divider />
      <SectionLabel>重要性评分</SectionLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: `${importanceColor}22`,
          border: `2px solid ${importanceColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 16,
          fontWeight: 600,
          color: importanceColor,
        }}>
          {importanceScore}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--t-secondary)' }}>
            {importanceScore >= 8 ? '核心实体' : importanceScore >= 5 ? '重要实体' : '辅助实体'}
          </div>
          {typeof props.importance_reason === 'string' && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--t-muted)', marginTop: 4 }}>
              {props.importance_reason}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {typeof props.description === 'string' && (
        <>
          <Divider />
          <SectionLabel>描述</SectionLabel>
          <div style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            color: 'var(--t-secondary)',
            lineHeight: 1.6,
          }}>
            {props.description}
          </div>
        </>
      )}

      {/* Role in system */}
      {typeof props.role_in_system === 'string' && (
        <>
          <Divider />
          <SectionLabel>系统角色</SectionLabel>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--t-secondary)',
            background: 'var(--s-raised)',
            border: '1px solid var(--b-faint)',
            borderRadius: 4,
            padding: '8px 12px',
          }}>
            {props.role_in_system}
          </div>
        </>
      )}
    </>
  )
}

// ─── Field Details Component ───────────────────────────────────────────────────

const FieldDetails: React.FC<{ node: GraphNode }> = ({ node }) => {
  const props = node.properties ?? {}

  return (
    <>
      {/* Field type */}
      {typeof props.type === 'string' && (
        <>
          <SectionLabel>字段类型</SectionLabel>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: '#b08eff',
            background: 'rgba(176,142,255,0.08)',
            border: '1px solid rgba(176,142,255,0.2)',
            borderRadius: 4,
            padding: '6px 10px',
          }}>
            {props.type}
          </div>
        </>
      )}

      {/* Column name */}
      {typeof props.column_name === 'string' && (
        <>
          <Divider />
          <SectionLabel>数据库列名</SectionLabel>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--t-secondary)',
            background: 'var(--s-raised)',
            border: '1px solid var(--b-faint)',
            borderRadius: 4,
            padding: '6px 10px',
          }}>
            {props.column_name}
          </div>
        </>
      )}

      {/* Field flags */}
      <Divider />
      <SectionLabel>字段属性</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {props.is_primary_key === true && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: '#00d4ff',
            background: 'rgba(0,212,255,0.1)',
            border: '1px solid rgba(0,212,255,0.3)',
            borderRadius: 3,
            padding: '4px 8px',
          }}>
            🔑 主键
          </span>
        )}
        {props.is_foreign_key === true && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: '#ffc145',
            background: 'rgba(255,193,69,0.1)',
            border: '1px solid rgba(255,193,69,0.3)',
            borderRadius: 3,
            padding: '4px 8px',
          }}>
            🔗 外键
          </span>
        )}
        {props.is_nullable === false && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: '#ff6b6b',
            background: 'rgba(255,107,107,0.1)',
            border: '1px solid rgba(255,107,107,0.3)',
            borderRadius: 3,
            padding: '4px 8px',
          }}>
            NOT NULL
          </span>
        )}
      </div>

      {/* Foreign key reference */}
      {props.is_foreign_key === true && typeof props.references_entity === 'string' && (
        <>
          <Divider />
          <SectionLabel>外键引用</SectionLabel>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--t-secondary)',
            background: 'var(--s-raised)',
            border: '1px solid var(--b-faint)',
            borderRadius: 4,
            padding: '8px 12px',
          }}>
            → {props.references_entity}.{typeof props.references_field === 'string' ? props.references_field : 'id'}
          </div>
        </>
      )}

      {/* Business meaning */}
      {typeof props.business_meaning === 'string' && (
        <>
          <Divider />
          <SectionLabel>业务含义</SectionLabel>
          <div style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 11,
            color: 'var(--t-secondary)',
            lineHeight: 1.5,
          }}>
            {props.business_meaning}
          </div>
        </>
      )}

      {/* Description */}
      {typeof props.description === 'string' && (
        <>
          <Divider />
          <SectionLabel>描述</SectionLabel>
          <div style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 11,
            color: 'var(--t-secondary)',
            lineHeight: 1.5,
          }}>
            {props.description}
          </div>
        </>
      )}
    </>
  )
}

// ─── Flow Details Component ────────────────────────────────────────────────────

const FlowDetails: React.FC<{ node: GraphNode }> = ({ node }) => {
  const props = node.properties ?? {}

  return (
    <>
      {/* Flow type */}
      {typeof props.flow_type === 'string' && (
        <>
          <SectionLabel>流程类型</SectionLabel>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: '#ffcc44',
            background: 'rgba(255,204,68,0.08)',
            border: '1px solid rgba(255,204,68,0.2)',
            borderRadius: 4,
            padding: '6px 10px',
          }}>
            {props.flow_type}
          </div>
        </>
      )}

      {/* Flow key */}
      {typeof props.key === 'string' && (
        <>
          <Divider />
          <SectionLabel>流程标识</SectionLabel>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--t-secondary)',
            background: 'var(--s-raised)',
            border: '1px solid var(--b-faint)',
            borderRadius: 4,
            padding: '6px 10px',
          }}>
            {props.key}
          </div>
        </>
      )}

      {/* Description */}
      {typeof props.description === 'string' && (
        <>
          <Divider />
          <SectionLabel>描述</SectionLabel>
          <div style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            color: 'var(--t-secondary)',
            lineHeight: 1.6,
          }}>
            {props.description}
          </div>
        </>
      )}
    </>
  )
}

// ─── NodeDetailPanel ──────────────────────────────────────────────────────────

const NodeDetailPanel: React.FC<NodeDetailPanelProps> = ({ node, edges = [], allNodes = [], onClose }) => {
  const meta = node ? getTypeMeta(node.type) : TYPE_META.default

  // Derive related nodes from edges
  const { outgoing, incoming } = useMemo<{ outgoing: RelatedNode[]; incoming: RelatedNode[] }>(() => {
    if (!node) return { outgoing: [], incoming: [] }
    const nodeMap = new Map(allNodes.map(n => [n.id, n]))

    const out: RelatedNode[] = edges
      .filter(e => e.source === node.id)
      .map(e => ({ node: nodeMap.get(e.target) ?? { id: e.target, type: 'Unknown', label: e.target }, edgeType: e.type, dir: 'out' }))

    const inc: RelatedNode[] = edges
      .filter(e => e.target === node.id)
      .map(e => ({ node: nodeMap.get(e.source) ?? { id: e.source, type: 'Unknown', label: e.source }, edgeType: e.type, dir: 'in' }))

    return { outgoing: out, incoming: inc }
  }, [node, edges, allNodes])

  const properties = node?.properties ?? {}
  const propEntries = Object.entries(properties)

  const apiNodes = [...outgoing, ...incoming].filter(r => r.node.type === 'API' || r.edgeType === 'calls')

  return (
    <Drawer
      open={!!node}
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
        node ? (
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
                maxWidth:      210,
                overflow:      'hidden',
                textOverflow:  'ellipsis',
                whiteSpace:    'nowrap',
              }}>
                {node.label}
              </div>
              <div style={{
                fontFamily:    'var(--font-mono)',
                fontSize:      9,
                color:         meta.color,
                letterSpacing: '0.1em',
                marginTop:     2,
              }}>
                {node.type.toUpperCase()}
              </div>
            </div>
          </div>
        ) : null
      }
    >
      {node && (
        <>
          {/* ── Node ID ──────────────────────────────────────── */}
          <SectionLabel>节点 ID</SectionLabel>
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
            {node.id}
          </div>

          {/* ── Properties ───────────────────────────────────── */}
          {/* Entity 类型特殊展示 */}
          {node.type === 'Entity' && <EntityDetails node={node} />}

          {/* Field 类型特殊展示 */}
          {node.type === 'Field' && <FieldDetails node={node} />}

          {/* Flow 类型特殊展示 */}
          {node.type === 'Flow' && <FlowDetails node={node} />}

          {/* 其他类型通用属性展示 */}
          {!['Entity', 'Field', 'Flow'].includes(node.type) && propEntries.length > 0 && (
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

          {/* ── Outgoing dependencies ─────────────────────────── */}
          {outgoing.length > 0 && (
            <>
              <Divider />
              <SectionLabel>依赖 ({outgoing.length})</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {outgoing.map((r, i) => (
                  <RelatedNodeRow key={i} related={r} />
                ))}
              </div>
            </>
          )}

          {/* ── Incoming references ───────────────────────────── */}
          {incoming.length > 0 && (
            <>
              <Divider />
              <SectionLabel>被引用 ({incoming.length})</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {incoming.map((r, i) => (
                  <RelatedNodeRow key={i} related={r} />
                ))}
              </div>
            </>
          )}

          {/* ── Related APIs ──────────────────────────────────── */}
          {apiNodes.length > 0 && (
            <>
              <Divider />
              <SectionLabel>相关接口 ({apiNodes.length})</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {apiNodes.map((r, i) => (
                  <RelatedNodeRow key={i} related={r} highlight />
                ))}
              </div>
            </>
          )}

          {/* Empty state for no connections */}
          {outgoing.length === 0 && incoming.length === 0 && (
            <>
              <Divider />
              <div style={{
                textAlign:     'center',
                padding:       '24px 0',
                fontFamily:    'var(--font-mono)',
                fontSize:      10,
                color:         'var(--t-muted)',
                letterSpacing: '0.08em',
              }}>
                暂无连接
              </div>
            </>
          )}
        </>
      )}
    </Drawer>
  )
}

// ─── RelatedNodeRow ───────────────────────────────────────────────────────────

const RelatedNodeRow: React.FC<{ related: RelatedNode; highlight?: boolean }> = ({ related, highlight }) => {
  const { node, edgeType, dir } = related
  const edgeColor = EDGE_COLORS[edgeType] ?? '#4a5068'
  const nodeMeta  = getTypeMeta(node.type)

  return (
    <div style={{
      display:       'flex',
      alignItems:    'center',
      gap:           8,
      background:    highlight ? `rgba(255,107,107,0.05)` : 'var(--s-raised)',
      border:        `1px solid ${highlight ? 'rgba(255,107,107,0.15)' : 'var(--b-faint)'}`,
      borderRadius:  4,
      padding:       '6px 10px',
    }}>
      {/* Direction arrow */}
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize:   10,
        color:      edgeColor,
        flexShrink: 0,
      }}>
        {dir === 'out' ? '→' : '←'}
      </span>

      {/* Edge type chip */}
      <span style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      8,
        color:         edgeColor,
        background:    `${edgeColor}18`,
        border:        `1px solid ${edgeColor}40`,
        borderRadius:  3,
        padding:       '1px 5px',
        letterSpacing: '0.06em',
        flexShrink:    0,
        whiteSpace:    'nowrap',
      }}>
        {edgeType}
      </span>

      {/* Node type dot */}
      <span style={{
        width:       6,
        height:      6,
        borderRadius: '50%',
        background:  nodeMeta.color,
        flexShrink:  0,
      }} />

      {/* Node label */}
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
    </div>
  )
}

export default NodeDetailPanel
