import React, { useState } from 'react'
import { Drawer, Checkbox, Slider, Button, Space, Divider } from 'antd'
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons'
import type { GraphNode, GraphEdge } from '../../../types/graph'

// ─── Types ────────────────────────────────────────────────────────────────────

export type GraphFilters = {
  nodeTypes: string[]
  edgeTypes: string[]
  minDegree: number
  maxDegree: number
  showIsolated: boolean
}

export type FilterPanelProps = {
  open: boolean
  onClose: () => void
  nodes: GraphNode[]
  edges: GraphEdge[]
  filters: GraphFilters
  onFiltersChange: (filters: GraphFilters) => void
}

// ─── FilterPanel ──────────────────────────────────────────────────────────────

const FilterPanel: React.FC<FilterPanelProps> = ({
  open,
  onClose,
  nodes,
  edges,
  filters,
  onFiltersChange,
}) => {
  const [localFilters, setLocalFilters] = useState<GraphFilters>(filters)

  // Extract unique types
  const nodeTypes = Array.from(new Set(nodes.map(n => n.type))).sort()
  const edgeTypes = Array.from(new Set(edges.map(e => e.type))).sort()

  // Calculate degree range
  const degrees = nodes.map(node => {
    const inDegree = edges.filter(e => e.target === node.id).length
    const outDegree = edges.filter(e => e.source === node.id).length
    return inDegree + outDegree
  })
  const maxDegreeValue = Math.max(...degrees, 10)

  const handleApply = () => {
    onFiltersChange(localFilters)
    onClose()
  }

  const handleReset = () => {
    const defaultFilters: GraphFilters = {
      nodeTypes: nodeTypes,
      edgeTypes: edgeTypes,
      minDegree: 0,
      maxDegree: maxDegreeValue,
      showIsolated: true,
    }
    setLocalFilters(defaultFilters)
    onFiltersChange(defaultFilters)
  }

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FilterOutlined style={{ color: 'var(--a-cyan)' }} />
          <span>Graph Filters</span>
        </div>
      }
      placement="right"
      open={open}
      onClose={onClose}
      width={320}
      footer={
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>
            Reset
          </Button>
          <Button type="primary" onClick={handleApply}>
            Apply Filters
          </Button>
        </Space>
      }
    >
      {/* Node Types */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--t-secondary)',
            letterSpacing: '0.1em',
            marginBottom: 12,
            textTransform: 'uppercase',
          }}
        >
          Node Types ({localFilters.nodeTypes.length}/{nodeTypes.length})
        </div>
        <Checkbox.Group
          value={localFilters.nodeTypes}
          onChange={types =>
            setLocalFilters({ ...localFilters, nodeTypes: types as string[] })
          }
          style={{ width: '100%' }}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            {nodeTypes.map(type => (
              <Checkbox key={type} value={type}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {type}
                </span>
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      </div>

      <Divider />

      {/* Edge Types */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--t-secondary)',
            letterSpacing: '0.1em',
            marginBottom: 12,
            textTransform: 'uppercase',
          }}
        >
          Edge Types ({localFilters.edgeTypes.length}/{edgeTypes.length})
        </div>
        <Checkbox.Group
          value={localFilters.edgeTypes}
          onChange={types =>
            setLocalFilters({ ...localFilters, edgeTypes: types as string[] })
          }
          style={{ width: '100%' }}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            {edgeTypes.map(type => (
              <Checkbox key={type} value={type}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {type}
                </span>
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      </div>

      <Divider />

      {/* Degree Range */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--t-secondary)',
            letterSpacing: '0.1em',
            marginBottom: 12,
            textTransform: 'uppercase',
          }}
        >
          Node Degree Range
        </div>
        <Slider
          range
          min={0}
          max={maxDegreeValue}
          value={[localFilters.minDegree, localFilters.maxDegree]}
          onChange={([min, max]) =>
            setLocalFilters({ ...localFilters, minDegree: min, maxDegree: max })
          }
          marks={{
            0: '0',
            [maxDegreeValue]: String(maxDegreeValue),
          }}
        />
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--t-muted)',
            marginTop: 8,
          }}
        >
          {localFilters.minDegree} - {localFilters.maxDegree} connections
        </div>
      </div>

      <Divider />

      {/* Show Isolated Nodes */}
      <div>
        <Checkbox
          checked={localFilters.showIsolated}
          onChange={e =>
            setLocalFilters({ ...localFilters, showIsolated: e.target.checked })
          }
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            Show isolated nodes
          </span>
        </Checkbox>
      </div>
    </Drawer>
  )
}

export default FilterPanel
