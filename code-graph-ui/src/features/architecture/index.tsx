import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Spin, Button } from 'antd'
import { useRepoStore } from '../../store/repoStore'
import { useGraphEngineStore } from '../../graph-engine/store/graphEngineStore'
// import { createGraphLoader, GraphLoader } from '../../graph-engine/loader/GraphLoader'
// import { ArchitectureCanvas } from '../../components/graph/ArchitectureCanvas'
import RepoSelector from '../../components/ui/RepoSelector'
import LayeredArchitecture from '../../components/graph/LayeredArchitecture'
import { graphEndpoints } from '../../core/api'
import type { ArchitectureData } from '../../types/architecture'

const ArchitectureExplorer: React.FC = () => {
  const [searchParams] = useSearchParams()

  const activeRepo    = useRepoStore(s => s.activeRepo)
  const repos         = useRepoStore(s => s.repos)
  const setActiveRepo = useRepoStore(s => s.setActiveRepo)

  const loadingStatus    = useGraphEngineStore(s => s.loading.status)
  const loadingError     = useGraphEngineStore(s => s.loading.error)

  // 分层架构数据状态
  const [layeredData, setLayeredData] = useState<ArchitectureData | null>(null)
  const [isLoadingLayered, setIsLoadingLayered] = useState(false)
  const [layeredError, setLayeredError] = useState<string | null>(null)

  // ── URL 参数同步（用 repo_id 参数代替旧的 graph_id）─────────────────────
  useEffect(() => {
    const urlRepoId = searchParams.get('repo_id') ?? searchParams.get('graph_id')
    if (!urlRepoId) return
    if (activeRepo?.repoId === urlRepoId) return
    const repo = repos.find(r => r.repoId === urlRepoId)
    if (repo) setActiveRepo(repo)
  }, [searchParams, repos, activeRepo, setActiveRepo])

  // ── 检测是否为分层架构数据 ────────────────────────────────────────────────
  useEffect(() => {
    const currentRepoId = activeRepo?.repoId
    if (!currentRepoId) {
      setLayeredData(null)
      return
    }

    // 尝试加载分层架构数据
    const loadLayeredArchitecture = async () => {
      setIsLoadingLayered(true)
      setLayeredError(null)
      setLayeredData(null)

      try {
        const data = await graphEndpoints.getArchitecture(currentRepoId) as ArchitectureData
        if (data && data.layers && Array.isArray(data.layers)) {
          setLayeredData(data)
        }
      } catch (err) {
        // 404 表示没有分层架构数据，这是正常情况
        const errorMessage = String(err)
        if (!errorMessage.includes('404')) {
          setLayeredError(errorMessage)
        }
      } finally {
        setIsLoadingLayered(false)
      }
    }

    loadLayeredArchitecture()
  }, [activeRepo?.repoId])

  // ── 仓库切换：初始化 GraphLoader 并加载（已禁用，仅使用分层架构）────────────
  // useEffect(() => {
  //   const currentRepoId = activeRepo?.repoId
  //   if (!currentRepoId) return

  //   // 如果有分层架构数据，不需要加载标准图谱
  //   if (layeredData) return

  //   // eslint-disable-next-line @typescript-eslint/no-explicit-any
  //   const analysisTimestamp = (activeRepo as any)?.latestAnalysis?.lastAnalyzedAt ?? ''

  //   if (loaderRef.current && useGraphEngineStore.getState().repoId === currentRepoId) {
  //     ;(loaderRef.current as GraphLoader).invalidateCache(analysisTimestamp)
  //   } else {
  //     loaderRef.current = createGraphLoader(currentRepoId, analysisTimestamp)
  //   }

  //   initGraph(currentRepoId)
  //   setLoadingStatus('loading')

  //   ;(loaderRef.current as GraphLoader)
  //     .loadInitial()
  //     .then(result => {
  //       // 将初始节点/边通过 CustomEvent 发送给 ArchitectureCanvas
  //       window.dispatchEvent(new CustomEvent('graphloader:merge', {
  //         detail: { nodes: result.nodes, edges: result.edges },
  //       }))
  //       // 初始加载完成后触发 dagre 层次布局（节点默认堆叠在原点）
  //       window.dispatchEvent(new CustomEvent('architecturecanvas:dagre-layout'))
  //       setLoadingStatus('idle')
  //     })
  //     .catch((err: unknown) => {
  //       setLoadingError(String(err))
  //     })
  // }, [activeRepo?.repoId, layeredData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 展开/折叠回调（已禁用）─────────────────────────────────────────────────
  // const handleNodeExpand = useCallback(async (_nodeId: string) => {
  //   // if (!loaderRef.current) return
  //   // try {
  //   //   const result = await (loaderRef.current as GraphLoader).expandNode(nodeId)
  //   //   if (result?.has_more) {
  //   //     void message.info(`已展示前 ${result.node_count} 个子节点（还有更多）`)
  //   //   }
  //   // } catch (err) {
  //   //   void message.error(`展开失败: ${err}`)
  //   // }
  // }, [])

  // const handleNodeCollapse = useCallback((_nodeId: string) => {
  //   // (loaderRef.current as GraphLoader)?.collapseNode(nodeId)
  // }, [])

  const handleRelayout = () => {
    window.dispatchEvent(new CustomEvent('architecturecanvas:relayout'))
  }

  const isLoading = loadingStatus === 'loading' || isLoadingLayered

  // 决定渲染哪种视图
  const renderContent = () => {
    if (!activeRepo) {
      return <Alert type="info" message="请选择一个仓库以可视化其架构图" showIcon />
    }

    if (loadingError || layeredError) {
      return <Alert type="error" message={`加载失败: ${loadingError || layeredError}`} showIcon />
    }

    // 优先渲染分层架构视图
    if (layeredData) {
      return (
        <div style={{ flex: 1, minHeight: 0 }}>
          <LayeredArchitecture data={layeredData} height="100%" />
        </div>
      )
    }

    // 无分层架构数据时显示提示
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isLoading ? (
          <Spin tip="加载架构图..." />
        ) : (
          <Alert type="info" message="该仓库暂无分层架构数据" showIcon />
        )}
      </div>
    )

    // 降级到标准图谱视图（已禁用）
    // return (
    //   <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
    //     {isLoading && (
    //       <div style={{
    //         position: 'absolute', inset: 0, display: 'flex',
    //         alignItems: 'center', justifyContent: 'center',
    //         background: 'rgba(7,9,13,0.6)', zIndex: 10,
    //       }}>
    //         <Spin tip="加载架构图..." />
    //       </div>
    //     )}
    //     <ArchitectureCanvas
    //       key={activeRepo.repoId}
    //       onNodeExpand={handleNodeExpand}
    //       onNodeCollapse={handleNodeCollapse}
    //       height="100%"
    //     />
    //   </div>
    // )
  }

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
          {!layeredData && <Button size="small" onClick={handleRelayout}>重排布局</Button>}
          <RepoSelector showStats={false} />
        </div>
      </div>

      {/* ── 内容区域 ──────────────────────────────────────────────────────── */}
      {renderContent()}
    </div>
  )
}

export default ArchitectureExplorer
