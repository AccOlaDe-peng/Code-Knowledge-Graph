import React, { useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Spin, Button, message } from 'antd'
import { useRepoStore } from '../../store/repoStore'
import { useGraphEngineStore } from '../../graph-engine/store/graphEngineStore'
import { createGraphLoader, GraphLoader } from '../../graph-engine/loader/GraphLoader'
import { ArchitectureCanvas } from '../../components/graph/ArchitectureCanvas'
import RepoSelector from '../../components/ui/RepoSelector'

const ArchitectureExplorer: React.FC = () => {
  const [searchParams] = useSearchParams()

  const activeRepo    = useRepoStore(s => s.activeRepo)
  const repos         = useRepoStore(s => s.repos)
  const setActiveRepo = useRepoStore(s => s.setActiveRepo)

  const initGraph        = useGraphEngineStore(s => s.initGraph)
  const setLoadingStatus = useGraphEngineStore(s => s.setLoadingStatus)
  const setLoadingError  = useGraphEngineStore(s => s.setLoadingError)
  const loadingStatus    = useGraphEngineStore(s => s.loading.status)
  const loadingError     = useGraphEngineStore(s => s.loading.error)

  const loaderRef = useRef<GraphLoader | null>(null)

  // ── URL 参数同步（用 repo_id 参数代替旧的 graph_id）─────────────────────
  useEffect(() => {
    const urlRepoId = searchParams.get('repo_id') ?? searchParams.get('graph_id')
    if (!urlRepoId) return
    if (activeRepo?.repoId === urlRepoId) return
    const repo = repos.find(r => r.repoId === urlRepoId)
    if (repo) setActiveRepo(repo)
  }, [searchParams, repos, activeRepo, setActiveRepo])

  // ── 仓库切换：初始化 GraphLoader 并加载 ──────────────────────────────────
  useEffect(() => {
    const currentRepoId = activeRepo?.repoId
    if (!currentRepoId) return

    const analysisTimestamp = (activeRepo as any)?.latestAnalysis?.lastAnalyzedAt ?? ''

    if (loaderRef.current && useGraphEngineStore.getState().repoId === currentRepoId) {
      loaderRef.current.invalidateCache(analysisTimestamp)
    } else {
      loaderRef.current = createGraphLoader(currentRepoId, analysisTimestamp)
    }

    initGraph(currentRepoId)
    setLoadingStatus('loading')

    loaderRef.current
      .loadInitial()
      .then(result => {
        // 将初始节点/边通过 CustomEvent 发送给 ArchitectureCanvas
        window.dispatchEvent(new CustomEvent('graphloader:merge', {
          detail: { nodes: result.nodes, edges: result.edges },
        }))
        setLoadingStatus('idle')
      })
      .catch((err: unknown) => {
        setLoadingError(String(err))
      })
  }, [activeRepo?.repoId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 展开/折叠回调 ────────────────────────────────────────────────────────
  const handleNodeExpand = useCallback(async (nodeId: string) => {
    if (!loaderRef.current) return
    try {
      const result = await loaderRef.current.expandNode(nodeId)
      if (result?.has_more) {
        void message.info(`已展示前 ${result.node_count} 个子节点（还有更多）`)
      }
    } catch (err) {
      void message.error(`展开失败: ${err}`)
    }
  }, [])

  const handleNodeCollapse = useCallback((nodeId: string) => {
    loaderRef.current?.collapseNode(nodeId)
  }, [])

  const handleRelayout = useCallback(() => {
    window.dispatchEvent(new CustomEvent('architecturecanvas:relayout'))
  }, [])

  const isLoading = loadingStatus === 'loading'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── 页头 ─────────────────────────────────────────────────────────── */}
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
            margin: 0, fontSize: 22, fontWeight: 700,
            color: 'var(--t-primary)', fontFamily: 'var(--font-ui)',
          }}>
            架构视图
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button size="small" onClick={handleRelayout}>重排布局</Button>
          <RepoSelector showStats={false} />
        </div>
      </div>

      {/* ── 状态提示 ─────────────────────────────────────────────────────── */}
      {!activeRepo && (
        <Alert type="info" message="请选择一个仓库以可视化其架构图" showIcon />
      )}
      {loadingError && (
        <Alert type="error" message={`加载失败: ${loadingError}`} showIcon />
      )}

      {/* ── 画布 ─────────────────────────────────────────────────────────── */}
      {activeRepo && (
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {isLoading && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(7,9,13,0.6)', zIndex: 10,
            }}>
              <Spin tip="加载架构图..." />
            </div>
          )}
          <ArchitectureCanvas
            key={activeRepo.repoId}
            onNodeExpand={handleNodeExpand}
            onNodeCollapse={handleNodeCollapse}
            height="100%"
          />
        </div>
      )}
    </div>
  )
}

export default ArchitectureExplorer
