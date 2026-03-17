import React, { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert } from 'antd'
import { useRepoStore } from '../../store/repoStore'
import { useGraphStore } from '../../store/graphStore'
import { GraphViewerPro } from '../../components/graph-viewer'
import RepoSelector from '../../components/ui/RepoSelector'

// ─── Architecture Explorer ────────────────────────────────────────────────────

const ArchitectureExplorer: React.FC = () => {
  const [searchParams] = useSearchParams()
  const activeRepo = useRepoStore(s => s.activeRepo)
  const repos      = useRepoStore(s => s.repos)
  const setActiveRepo  = useRepoStore(s => s.setActiveRepo)
  const setActiveGraphId = useGraphStore(s => s.setActiveGraphId)

  // 从 URL 参数初始化选中仓库（由仓库页面跳转过来时携带 graph_id）
  useEffect(() => {
    const urlGraphId = searchParams.get('graph_id')
    if (!urlGraphId) return
    if (activeRepo?.graphId === urlGraphId) return
    const repo = repos.find(r => r.graphId === urlGraphId)
    if (repo) {
      setActiveRepo(repo)
      setActiveGraphId(urlGraphId)
    }
  }, [searchParams, repos, activeRepo, setActiveRepo, setActiveGraphId])

  const graphId = activeRepo?.graphId ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        paddingBottom: 14,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            color: 'var(--t-muted)',
            letterSpacing: '0.15em',
            marginBottom: 4,
          }}>
            系统 / 架构图
          </div>
          <h2 style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--t-primary)',
            fontFamily: 'var(--font-ui)',
          }}>
            架构视图
          </h2>
        </div>

        <RepoSelector showStats={false} />
      </div>

      {/* ── No repo selected ────────────────────────────────────────────── */}
      {!graphId && (
        <Alert
          type="info"
          message="请选择一个仓库以可视化其架构图"
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
