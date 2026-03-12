import React from 'react'
import { Button, Select, Tooltip } from 'antd'
import {
  ApartmentOutlined,
  FilterOutlined,
  FullscreenOutlined,
  ReloadOutlined,
  SearchOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons'
import {
  useGraphEngineStore,
  selectNodeCount,
  selectEdgeCount,
  selectCurrentLOD,
  selectZoom,
} from '../../graph-engine/store'
import { LODLevel } from '../../graph-engine/types'
import type { LODLevelValue } from '../../graph-engine/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type GraphToolbarProps = {
  onRunLayout:     () => void
  onZoomIn:        () => void
  onZoomOut:       () => void
  onFitView:       () => void
  onReset:         () => void
  onToggleSearch:  () => void
  onToggleFilter:  () => void
  isSearchOpen:    boolean
  isFilterOpen:    boolean
  isLayoutRunning: boolean
}

// ─── LOD Options ──────────────────────────────────────────────────────────────

const LOD_OPTIONS: { value: LODLevelValue; label: string }[] = [
  { value: LODLevel.Module,   label: 'Module' },
  { value: LODLevel.File,     label: 'File' },
  { value: LODLevel.Class,    label: 'Class' },
  { value: LODLevel.Function, label: 'Function' },
]

// ─── GraphToolbar ─────────────────────────────────────────────────────────────

export const GraphToolbar: React.FC<GraphToolbarProps> = ({
  onRunLayout,
  onZoomIn,
  onZoomOut,
  onFitView,
  onReset,
  onToggleSearch,
  onToggleFilter,
  isSearchOpen,
  isFilterOpen,
  isLayoutRunning,
}) => {
  const nodeCount  = useGraphEngineStore(selectNodeCount)
  const edgeCount  = useGraphEngineStore(selectEdgeCount)
  const currentLOD = useGraphEngineStore(selectCurrentLOD)
  const zoom       = useGraphEngineStore(selectZoom)
  const setLOD     = useGraphEngineStore(s => s.setLODLevel)

  return (
    <div style={toolbarStyle}>
      {/* ── Left: brand + stats ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={brandDotStyle} />
          <span style={brandLabelStyle}>GRAPH VIEWER</span>
        </div>

        <div style={dividerStyle} />

        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
          <Stat label="NODES" value={nodeCount} color="#00d4ff" />
          <Stat label="EDGES" value={edgeCount} color="#00f084" />
          <Stat label="ZOOM"  value={`${Math.round(zoom * 100)}%`} color="#9ba8c8" />
        </div>
      </div>

      {/* ── Center: LOD + layout ────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={labelStyle}>DETAIL</span>
        <Select
          size="small"
          value={currentLOD}
          onChange={(v: LODLevelValue) => setLOD(v)}
          options={LOD_OPTIONS}
          style={{ width: 110 }}
          popupMatchSelectWidth={false}
          styles={{
            popup: {
              root: { background: '#111520', border: '1px solid rgba(255,255,255,0.1)' },
            },
          }}
        />

        <Tooltip title="Re-run layout">
          <Button
            size="small"
            icon={<ApartmentOutlined />}
            onClick={onRunLayout}
            loading={isLayoutRunning}
            style={actionBtnStyle}
          />
        </Tooltip>
      </div>

      {/* ── Right: tools + zoom ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Tooltip title="Search nodes (/)">
          <Button
            size="small"
            icon={<SearchOutlined />}
            onClick={onToggleSearch}
            style={{ ...actionBtnStyle, ...(isSearchOpen ? activeBtnStyle : {}) }}
          />
        </Tooltip>

        <Tooltip title="Filter by type">
          <Button
            size="small"
            icon={<FilterOutlined />}
            onClick={onToggleFilter}
            style={{ ...actionBtnStyle, ...(isFilterOpen ? activeBtnStyle : {}) }}
          />
        </Tooltip>

        <div style={dividerStyle} />

        <Tooltip title="Zoom in">
          <Button size="small" icon={<ZoomInOutlined />}  onClick={onZoomIn}  style={actionBtnStyle} />
        </Tooltip>
        <Tooltip title="Zoom out">
          <Button size="small" icon={<ZoomOutOutlined />} onClick={onZoomOut} style={actionBtnStyle} />
        </Tooltip>
        <Tooltip title="Fit view">
          <Button size="small" icon={<FullscreenOutlined />} onClick={onFitView} style={actionBtnStyle} />
        </Tooltip>

        <div style={dividerStyle} />

        <Tooltip title="Reset graph">
          <Button size="small" icon={<ReloadOutlined />} onClick={onReset} style={actionBtnStyle} />
        </Tooltip>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const Stat: React.FC<{ label: string; value: number | string; color: string }> = ({
  label, value, color,
}) => (
  <div style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
    <span style={{
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 14,
      fontWeight: 600,
      color,
      lineHeight: 1,
    }}>
      {typeof value === 'number' ? value.toLocaleString() : value}
    </span>
    <span style={{
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 9,
      color: '#3a4a5a',
      letterSpacing: '0.1em',
    }}>
      {label}
    </span>
  </div>
)

// ─── Styles ───────────────────────────────────────────────────────────────────

const toolbarStyle: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  gap:             12,
  padding:        '8px 14px',
  background:     'rgba(10,13,19,0.97)',
  borderBottom:   '1px solid rgba(255,255,255,0.05)',
  flexShrink:      0,
  backdropFilter: 'blur(8px)',
  minHeight:       48,
}

const brandDotStyle: React.CSSProperties = {
  width:        7,
  height:       7,
  borderRadius: '50%',
  background:   '#00d4ff',
  boxShadow:    '0 0 8px #00d4ff',
  flexShrink:    0,
}

const brandLabelStyle: React.CSSProperties = {
  fontFamily:    '"Syne", sans-serif',
  fontSize:       12,
  fontWeight:     700,
  color:         '#00d4ff',
  letterSpacing: '0.12em',
}

const dividerStyle: React.CSSProperties = {
  width:      1,
  height:     16,
  background: 'rgba(255,255,255,0.08)',
  flexShrink:  0,
  margin:     '0 4px',
}

const labelStyle: React.CSSProperties = {
  fontFamily:    '"IBM Plex Mono", monospace',
  fontSize:       10,
  color:         '#3a5a6a',
  letterSpacing: '0.1em',
  whiteSpace:    'nowrap',
}

const actionBtnStyle: React.CSSProperties = {
  background:    '#0d1520',
  border:        '1px solid rgba(255,255,255,0.1)',
  color:         '#6b7a9d',
  borderRadius:   4,
}

const activeBtnStyle: React.CSSProperties = {
  background:   'rgba(0,212,255,0.12)',
  border:       '1px solid rgba(0,212,255,0.4)',
  color:        '#00d4ff',
}
