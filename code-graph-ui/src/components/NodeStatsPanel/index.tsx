import React from 'react'
import { Tooltip } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  BranchesOutlined,
} from '@ant-design/icons'

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeStatsPanelProps = {
  inDegree: number
  outDegree: number
  impactRange: number
}

// ─── NodeStatsPanel ───────────────────────────────────────────────────────────

const NodeStatsPanel: React.FC<NodeStatsPanelProps> = ({
  inDegree,
  outDegree,
  impactRange,
}) => {
  const stats = [
    {
      label:     '入度',
      value:     inDegree,
      icon:      <ArrowDownOutlined />,
      color:     '#00f084',
      tip:       '被引用次数',
    },
    {
      label:     '出度',
      value:     outDegree,
      icon:      <ArrowUpOutlined />,
      color:     '#00d4ff',
      tip:       '引用其他节点次数',
    },
    {
      label:     '影响范围',
      value:     impactRange,
      icon:      <BranchesOutlined />,
      color:     '#ffc145',
      tip:       '可达节点数',
    },
  ]

  return (
    <div style={{
      display:  'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap:      8,
    }}>
      {stats.map((stat) => (
        <Tooltip key={stat.label} title={stat.tip}>
          <div style={{
            background:    `${stat.color}08`,
            border:        `1px solid ${stat.color}33`,
            borderRadius:  4,
            padding:       '10px 8px',
            textAlign:     'center',
            cursor:        'help',
          }}>
            <div style={{
              display:     'flex',
              alignItems:  'center',
              justifyContent: 'center',
              gap:         4,
              marginBottom: 4,
            }}>
              <span style={{ color: stat.color, fontSize: 10 }}>
                {stat.icon}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize:   16,
                fontWeight: 700,
                color:      stat.color,
              }}>
                {stat.value}
              </span>
            </div>
            <div style={{
              fontFamily:    'var(--font-mono)',
              fontSize:      8,
              color:         'var(--t-muted)',
              letterSpacing: '0.08em',
            }}>
              {stat.label}
            </div>
          </div>
        </Tooltip>
      ))}
    </div>
  )
}

export default NodeStatsPanel
