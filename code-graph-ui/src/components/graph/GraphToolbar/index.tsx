import React from 'react'
import { Button, Space, Select, Tooltip } from 'antd'
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
  ReloadOutlined,
  DownloadOutlined,
  FilterOutlined,
} from '@ant-design/icons'
import type { LayoutName } from '../GraphViewer'

// ─── Types ────────────────────────────────────────────────────────────────────

export type GraphToolbarProps = {
  layout: LayoutName
  onLayoutChange: (layout: LayoutName) => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onFitView?: () => void
  onReset?: () => void
  onExport?: () => void
  onFilter?: () => void
  zoom?: number
  nodeCount?: number
  edgeCount?: number
  showStats?: boolean
}

// ─── Layout Options ───────────────────────────────────────────────────────────

const LAYOUT_OPTIONS = [
  { value: 'force' as LayoutName, label: '⊙ Force', icon: '⊙' },
  { value: 'dagre' as LayoutName, label: '⇣ Dagre', icon: '⇣' },
  { value: 'grid' as LayoutName, label: '⊞ Grid', icon: '⊞' },
]

// ─── GraphToolbar ─────────────────────────────────────────────────────────────

const GraphToolbar: React.FC<GraphToolbarProps> = ({
  layout,
  onLayoutChange,
  onZoomIn,
  onZoomOut,
  onFitView,
  onReset,
  onExport,
  onFilter,
  zoom = 1,
  nodeCount = 0,
  edgeCount = 0,
  showStats = true,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        background: 'var(--s-raised)',
        border: '1px solid var(--b-faint)',
        borderRadius: 'var(--radius-m)',
        marginBottom: 12,
      }}
    >
      {/* Left: Layout selector */}
      <Space size="middle">
        <Select
          value={layout}
          onChange={onLayoutChange}
          style={{ width: 140 }}
          size="small"
          options={LAYOUT_OPTIONS.map(opt => ({
            value: opt.value,
            label: opt.label,
          }))}
        />

        {showStats && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: 'var(--t-muted)',
                letterSpacing: '0.05em',
              }}
            >
              <span style={{ color: 'var(--t-cyan)' }}>{nodeCount}</span> nodes
            </span>
            <span style={{ color: 'var(--b-visible)', fontSize: 10 }}>·</span>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: 'var(--t-muted)',
                letterSpacing: '0.05em',
              }}
            >
              <span style={{ color: 'var(--t-green)' }}>{edgeCount}</span> edges
            </span>
          </div>
        )}
      </Space>

      {/* Right: Action buttons */}
      <Space size="small">
        {onFilter && (
          <Tooltip title="Filter nodes">
            <Button
              size="small"
              icon={<FilterOutlined />}
              onClick={onFilter}
            />
          </Tooltip>
        )}

        {onZoomIn && (
          <Tooltip title="Zoom in">
            <Button
              size="small"
              icon={<ZoomInOutlined />}
              onClick={onZoomIn}
            />
          </Tooltip>
        )}

        {onZoomOut && (
          <Tooltip title="Zoom out">
            <Button
              size="small"
              icon={<ZoomOutOutlined />}
              onClick={onZoomOut}
            />
          </Tooltip>
        )}

        {onFitView && (
          <Tooltip title="Fit to view">
            <Button
              size="small"
              icon={<FullscreenOutlined />}
              onClick={onFitView}
            />
          </Tooltip>
        )}

        {onReset && (
          <Tooltip title="Reset graph">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={onReset}
            />
          </Tooltip>
        )}

        {onExport && (
          <Tooltip title="Export graph">
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={onExport}
            />
          </Tooltip>
        )}

        {zoom !== undefined && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--t-secondary)',
              padding: '0 8px',
              minWidth: 50,
              textAlign: 'center',
            }}
          >
            {Math.round(zoom * 100)}%
          </div>
        )}
      </Space>
    </div>
  )
}

export default GraphToolbar
