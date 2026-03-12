import React from 'react'
import { Alert } from 'antd'
import { useRepoStore } from '../../store/repoStore'
import { GraphViewerPro } from '../../components/graph-viewer'

// ─── Architecture Explorer ────────────────────────────────────────────────────

const ArchitectureExplorer: React.FC = () => {
  const activeRepo = useRepoStore(s => s.activeRepo)
  const graphId = activeRepo?.graphId ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, paddingBottom: 12 }}>
        <div style={{
          fontSize: 9,
          fontFamily: 'var(--font-mono)',
          color: 'var(--t-muted)',
          letterSpacing: '0.15em',
          marginBottom: 4,
        }}>
          SYSTEM / ARCHITECTURE
        </div>
        <h2 style={{
          margin: 0,
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--t-primary)',
          fontFamily: 'var(--font-ui)',
        }}>
          Architecture Explorer
        </h2>
      </div>

      {/* ── No repo selected ────────────────────────────────────────────── */}
      {!graphId && (
        <Alert
          type="info"
          message="请在顶栏选择一个仓库以浏览架构图"
          showIcon
        />
      )}

      {/* ── GraphViewerPro (fills remaining height) ─────────────────────── */}
      {graphId && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <GraphViewerPro
            key={graphId}
            graphId={graphId}
            height="100%"
          />
        </div>
      )}
    </div>
  )
}

export default ArchitectureExplorer
