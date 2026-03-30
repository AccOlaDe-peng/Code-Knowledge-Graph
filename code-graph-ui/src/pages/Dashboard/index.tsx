import React, { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { useGraphStore } from '../../store/graphStore'
import { useRepoStore } from '../../store/repoStore'
import type { GraphNode, GraphEdge } from '../../types/graph'
import { SkeletonStatCard, SkeletonTable } from '../../components/ui/Skeleton'
import { EmptyGraph } from '../../components/ui/EmptyState'
import {
  IconModule,
  IconFunction,
  IconAPI,
  IconDatabase,
  IconEvent,
} from '../../components/ui/Icons'
import { graphApi } from '../../api/graphApi'

// ─── Quick Action Card Component ──────────────────────────────────────────────

type QuickActionCardProps = {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
  color: string
}

const QuickActionCard: React.FC<QuickActionCardProps> = ({
  icon,
  title,
  description,
  onClick,
  color,
}) => (
  <div
    onClick={onClick}
    style={{
      background: 'linear-gradient(145deg, var(--s-raised) 0%, var(--s-float) 100%)',
      border: '1px solid var(--b-faint)',
      borderRadius: 'var(--radius-l)',
      padding: '24px',
      cursor: 'pointer',
      transition: 'var(--transition-normal)',
      position: 'relative',
      overflow: 'hidden',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'translateY(-4px)'
      e.currentTarget.style.borderColor = `${color}40`
      e.currentTarget.style.boxShadow = `0 12px 32px ${color}15`
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'translateY(0)'
      e.currentTarget.style.borderColor = 'var(--b-faint)'
      e.currentTarget.style.boxShadow = 'none'
    }}
  >
    {/* Background glow */}
    <div
      style={{
        position: 'absolute',
        top: -30,
        right: -30,
        width: 100,
        height: 100,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color}12 0%, transparent 70%)`,
        pointerEvents: 'none',
      }}
    />
    <div style={{ position: 'relative', zIndex: 1 }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 'var(--radius-m)',
          background: `${color}15`,
          border: `1px solid ${color}30`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        {icon}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--t-primary)',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 13,
          color: 'var(--t-muted)',
          lineHeight: 1.5,
        }}
      >
        {description}
      </div>
    </div>
  </div>
)

// ─── Types ────────────────────────────────────────────────────────────────────

type MetricCardProps = {
  icon: React.ReactNode
  label: string
  value: number | string
  subLabel?: string
  color: string
  onClick?: () => void
}

type ActivityItemProps = {
  repo: {
    graphId: string
    repoName: string
    nodeCount: number
    edgeCount: number
    gitCommit?: string
    createdAt: string
  }
  index: number
  total: number
  onNavigate: () => void
}

// ─── Metric Card ──────────────────────────────────────────────────────────────

const MetricCard: React.FC<MetricCardProps> = ({
  icon,
  label,
  value,
  subLabel,
  color,
  onClick,
}) => (
  <div
    onClick={onClick}
    style={{
      background: 'linear-gradient(145deg, var(--s-raised) 0%, var(--s-float) 100%)',
      border: '1px solid var(--b-faint)',
      borderRadius: 'var(--radius-l)',
      padding: '20px 24px',
      position: 'relative',
      overflow: 'hidden',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'var(--transition-normal)',
    }}
    onMouseEnter={(e) => {
      if (onClick) {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.borderColor = `${color}40`
        e.currentTarget.style.boxShadow = `0 8px 24px ${color}15`
      }
    }}
    onMouseLeave={(e) => {
      if (onClick) {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.borderColor = 'var(--b-faint)'
        e.currentTarget.style.boxShadow = 'none'
      }
    }}
  >
    {/* Background glow */}
    <div
      style={{
        position: 'absolute',
        top: -20,
        right: -20,
        width: 80,
        height: 80,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color}18 0%, transparent 70%)`,
        pointerEvents: 'none',
      }}
    />

    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 36,
            fontWeight: 700,
            color: 'var(--t-primary)',
            lineHeight: 1,
            letterSpacing: '-0.03em',
          }}
        >
          {typeof value === 'number' ? value.toLocaleString() : value}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--t-secondary)',
            marginTop: 6,
          }}
        >
          {label}
        </div>
        {subLabel && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--t-muted)',
              marginTop: 4,
            }}
          >
            {subLabel}
          </div>
        )}
      </div>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--radius-m)',
          background: `${color}12`,
          border: `1px solid ${color}25`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
    </div>
  </div>
)

// ─── Activity Item ────────────────────────────────────────────────────────────

const ActivityItem: React.FC<ActivityItemProps> = ({ repo, index, total, onNavigate }) => {
  const timeAgo = useMemo(() => {
    const diff = Date.now() - new Date(repo.createdAt).getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 60) return `${minutes} 分钟前`
    if (hours < 24) return `${hours} 小时前`
    return `${days} 天前`
  }, [repo.createdAt])

  return (
    <div
      onClick={onNavigate}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        marginBottom: index < total - 1 ? 1 : 0,
        background: 'transparent',
        cursor: 'pointer',
        transition: 'var(--transition-fast)',
        borderBottom: index < total - 1 ? '1px solid var(--b-faint)' : 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--s-float)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {/* Status dot */}
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--a-green)',
          boxShadow: '0 0 8px rgba(0,240,132,0.5)',
          flexShrink: 0,
        }}
      />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--t-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {repo.repoName}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--t-muted)',
            marginTop: 2,
          }}
        >
          {repo.nodeCount.toLocaleString()} 节点 · {repo.edgeCount.toLocaleString()} 边
        </div>
      </div>

      {/* Commit SHA */}
      {repo.gitCommit && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--t-amber)',
            background: 'rgba(255,193,69,0.08)',
            border: '1px solid rgba(255,193,69,0.2)',
            borderRadius: 4,
            padding: '3px 8px',
          }}
        >
          {repo.gitCommit.slice(0, 7)}
        </div>
      )}

      {/* Time */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--t-muted)',
          flexShrink: 0,
        }}
      >
        {timeAgo}
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { activeGraphId, fullGraph, loadFullGraph } = useGraphStore()
  const { repos, loading: reposLoading, activeRepo, setRepos, setLoading, setError } = useRepoStore()

  // 初始加载仓库列表
  useEffect(() => {
    const loadRepos = async () => {
      if (repos.length > 0) return
      setLoading(true)
      try {
        const res = await graphApi.listGraphs()
        setRepos(res.graphs || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载仓库列表失败')
      } finally {
        setLoading(false)
      }
    }
    loadRepos()
  }, [repos.length, setRepos, setLoading, setError])

  useEffect(() => {
    if (activeGraphId) loadFullGraph(activeGraphId)
  }, [activeGraphId, loadFullGraph])

  const nodes: GraphNode[] = fullGraph.data?.nodes ?? []
  const edges: GraphEdge[] = fullGraph.data?.edges ?? []

  // ── Compute stats ──────────────────────────────────────────────────────────

  const nodeTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    nodes.forEach((n) => {
      counts[n.type] = (counts[n.type] ?? 0) + 1
    })
    return counts
  }, [nodes])

  const edgeTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    edges.forEach((e) => {
      counts[e.type] = (counts[e.type] ?? 0) + 1
    })
    return counts
  }, [edges])

  // Current repo stats
  const totalNodes = nodes.length
  const totalEdges = edges.length
  const moduleCount = nodeTypeCounts.Module ?? 0
  const functionCount = nodeTypeCounts.Function ?? 0
  const apiCount = nodeTypeCounts.API ?? 0
  const tableCount = nodeTypeCounts.Database ?? 0
  const eventCount = nodeTypeCounts.Event ?? 0

  // Global stats across all repos
  const totalRepos = repos.length
  const totalNodesAll = repos.reduce((sum, r) => sum + r.nodeCount, 0)
  const totalEdgesAll = repos.reduce((sum, r) => sum + r.edgeCount, 0)

  // ── ECharts: Node type distribution (donut) ─────────────────────────────────

  const donutOption: EChartsOption = useMemo(() => {
    const data = Object.entries(nodeTypeCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'var(--s-overlay)',
        borderColor: 'var(--b-subtle)',
        textStyle: {
          color: 'var(--t-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        },
        formatter: '{b}: {c} ({d}%)',
      },
      legend: {
        show: true,
        orient: 'vertical',
        right: 0,
        top: 'center',
        textStyle: {
          color: 'var(--t-secondary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
        },
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 12,
      },
      series: [
        {
          type: 'pie',
          radius: ['55%', '80%'],
          center: ['35%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 4,
            borderColor: 'var(--s-void)',
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 20,
              shadowColor: 'rgba(0,212,255,0.3)',
            },
          },
          data,
          color: ['#00d4ff', '#00f084', '#ffc145', '#b08eff', '#ff6b6b', '#7ed957'],
        },
      ],
    }
  }, [nodeTypeCounts])

  // ── ECharts: Edge type distribution (horizontal bar) ────────────────────────

  const barOption: EChartsOption = useMemo(() => {
    const entries = Object.entries(edgeTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
    const yData = entries.map(([name]) => name)
    const xData = entries.map(([, value]) => value)

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'var(--s-overlay)',
        borderColor: 'var(--b-subtle)',
        textStyle: {
          color: 'var(--t-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        },
        axisPointer: { type: 'shadow' },
      },
      grid: { left: 80, right: 16, top: 8, bottom: 8 },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: 'var(--b-faint)', type: 'dashed' } },
        axisLabel: {
          color: 'var(--t-muted)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
        },
      },
      yAxis: {
        type: 'category',
        data: yData,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: 'var(--t-secondary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
        },
      },
      series: [
        {
          type: 'bar',
          data: xData,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: '#00f08480' },
                { offset: 1, color: '#00f084' },
              ],
            },
            borderRadius: [0, 4, 4, 0],
          },
          barWidth: 16,
        },
      ],
    }
  }, [edgeTypeCounts])

  // ── Recent repos ────────────────────────────────────────────────────────────

  const recentRepos = repos.slice(0, 5)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, width: '100%' }}>
      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--t-muted)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          Dashboard
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 700,
            color: 'var(--t-primary)',
            fontFamily: 'var(--font-ui)',
            letterSpacing: '-0.02em',
          }}
        >
          概览
        </h1>
      </div>

      {/* ── Global Metrics ───────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <MetricCard
          icon={<div style={{ width: 20, height: 20, borderRadius: 4, background: 'var(--a-cyan)' }} />}
          label="仓库总数"
          value={totalRepos}
          subLabel="已分析项目"
          color="#00d4ff"
          onClick={() => navigate('/repository')}
        />
        <MetricCard
          icon={<div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--a-green)' }} />}
          label="节点总数"
          value={totalNodesAll}
          subLabel="所有仓库"
          color="#00f084"
        />
        <MetricCard
          icon={<div style={{ width: 20, height: 3, borderRadius: 2, background: 'var(--a-amber)' }} />}
          label="关系总数"
          value={totalEdgesAll}
          subLabel="所有仓库"
          color="#ffc145"
        />
      </div>

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 24 }}>
        {/* Left Column */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* ── Current Repo Detail (when repo is selected) ───────────────────── */}
          {activeGraphId && activeRepo && (
            <div
              style={{
                background: 'var(--s-raised)',
                border: '1px solid var(--b-faint)',
                borderRadius: 'var(--radius-l)',
                overflow: 'hidden',
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: '16px 24px',
                  borderBottom: '1px solid var(--b-faint)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 15,
                      fontWeight: 600,
                      color: 'var(--t-primary)',
                    }}
                  >
                    {activeRepo.repoName}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--t-muted)',
                      marginTop: 2,
                    }}
                  >
                    {totalNodes.toLocaleString()} 节点 · {totalEdges.toLocaleString()} 边
                  </div>
                </div>
                <div
                  onClick={() => navigate('/architecture')}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: 'var(--t-cyan)',
                    cursor: 'pointer',
                    padding: '6px 12px',
                    background: 'var(--a-cyan-dim)',
                    borderRadius: 4,
                  }}
                >
                  查看图谱
                </div>
              </div>

              {/* Stats Grid */}
              {fullGraph.loading ? (
                <div style={{ display: 'flex', gap: 1, padding: 1 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ flex: 1, padding: 16 }}>
                      <SkeletonStatCard />
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
                    gap: 1,
                    background: 'var(--b-faint)',
                  }}
                >
                  {[
                    { icon: <IconModule size={18} color="#00d4ff" />, label: '模块', value: moduleCount, color: '#00d4ff' },
                    { icon: <IconFunction size={18} color="#ffc145" />, label: '函数', value: functionCount, color: '#ffc145' },
                    { icon: <IconAPI size={18} color="#ff6b6b" />, label: '接口', value: apiCount, color: '#ff6b6b' },
                    { icon: <IconDatabase size={18} color="#b08eff" />, label: '数据表', value: tableCount, color: '#b08eff' },
                    { icon: <IconEvent size={18} color="#ffcc44" />, label: '事件', value: eventCount, color: '#ffcc44' },
                  ].map((item, i) => (
                    <div
                      key={i}
                      style={{
                        background: 'var(--s-raised)',
                        padding: '16px 20px',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ marginBottom: 8, opacity: 0.8 }}>{item.icon}</div>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 22,
                          fontWeight: 600,
                          color: 'var(--t-primary)',
                        }}
                      >
                        {item.value.toLocaleString()}
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 12,
                          color: 'var(--t-muted)',
                          marginTop: 4,
                        }}
                      >
                        {item.label}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Charts */}
              {nodes.length > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 1,
                    background: 'var(--b-faint)',
                    borderTop: '1px solid var(--b-faint)',
                  }}
                >
                  <div style={{ background: 'var(--s-raised)', padding: '20px 24px', minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--t-secondary)',
                        marginBottom: 16,
                      }}
                    >
                      节点类型分布
                    </div>
                    <ReactECharts option={donutOption} style={{ height: 200 }} />
                  </div>
                  <div style={{ background: 'var(--s-raised)', padding: '20px 24px', minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--t-secondary)',
                        marginBottom: 16,
                      }}
                    >
                      关系类型分布
                    </div>
                    <ReactECharts option={barOption} style={{ height: 200 }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Quick Actions (when no repo selected) ─────────────────────────── */}
          {!activeGraphId && (
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--t-secondary)',
                  marginBottom: 16,
                }}
              >
                快速开始
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                <QuickActionCard
                  icon={
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  }
                  title="添加新仓库"
                  description="导入代码仓库开始分析，生成知识图谱"
                  onClick={() => navigate('/repository')}
                  color="#00d4ff"
                />
                <QuickActionCard
                  icon={
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00f084" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                  }
                  title="查看分析历史"
                  description={repos.length > 0 ? `${repos.length} 个仓库已完成分析` : '暂无分析记录'}
                  onClick={() => navigate('/repository')}
                  color="#00f084"
                />
                <QuickActionCard
                  icon={
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffc145" strokeWidth="2">
                      <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  }
                  title="语义搜索"
                  description="使用自然语言查询代码知识"
                  onClick={() => navigate('/query')}
                  color="#ffc145"
                />
                <QuickActionCard
                  icon={
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#b08eff" strokeWidth="2">
                      <path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18" />
                    </svg>
                  }
                  title="架构探索"
                  description="可视化浏览系统架构和依赖关系"
                  onClick={() => navigate('/architecture')}
                  color="#b08eff"
                />
              </div>
            </div>
          )}

          {/* ── All Repos Overview (always visible when repos exist) ───────────── */}
          {repos.length > 0 && (
            <div
              style={{
                background: 'var(--s-raised)',
                border: '1px solid var(--b-faint)',
                borderRadius: 'var(--radius-l)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '16px 24px',
                  borderBottom: '1px solid var(--b-faint)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--t-primary)',
                  }}
                >
                  所有仓库
                </div>
                <div
                  onClick={() => navigate('/repository')}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: 'var(--t-cyan)',
                    cursor: 'pointer',
                  }}
                >
                  管理仓库
                </div>
              </div>
              <div style={{ maxHeight: 320, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--b-faint)' }}>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 500, color: 'var(--t-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>仓库名称</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 500, color: 'var(--t-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>节点</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 500, color: 'var(--t-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>边</th>
                      <th style={{ padding: '12px 24px', textAlign: 'right', fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 500, color: 'var(--t-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>分析时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repos.slice(0, 6).map((repo, i) => (
                      <tr
                        key={repo.graphId}
                        onClick={() => navigate('/architecture')}
                        style={{
                          background: 'var(--s-raised)',
                          cursor: 'pointer',
                          transition: 'var(--transition-fast)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--s-float)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'var(--s-raised)'
                        }}
                      >
                        <td style={{ padding: '14px 24px', borderBottom: i < Math.min(repos.length, 6) - 1 ? '1px solid var(--b-faint)' : 'none' }}>
                          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 500, color: 'var(--t-primary)' }}>{repo.repoName}</div>
                          {repo.gitCommit && (
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-muted)', marginTop: 2 }}>{repo.gitCommit.slice(0, 7)}</div>
                          )}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right', borderBottom: i < Math.min(repos.length, 6) - 1 ? '1px solid var(--b-faint)' : 'none' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--t-cyan)' }}>{repo.nodeCount.toLocaleString()}</span>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right', borderBottom: i < Math.min(repos.length, 6) - 1 ? '1px solid var(--b-faint)' : 'none' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--t-green)' }}>{repo.edgeCount.toLocaleString()}</span>
                        </td>
                        <td style={{ padding: '14px 24px', textAlign: 'right', borderBottom: i < Math.min(repos.length, 6) - 1 ? '1px solid var(--b-faint)' : 'none' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--t-muted)' }}>
                            {new Date(repo.createdAt).toLocaleDateString('zh-CN')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {repos.length > 6 && (
                <div
                  style={{
                    padding: '12px 24px',
                    borderTop: '1px solid var(--b-faint)',
                    textAlign: 'center',
                  }}
                >
                  <span
                    onClick={() => navigate('/repository')}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      color: 'var(--t-cyan)',
                      cursor: 'pointer',
                    }}
                  >
                    查看全部 {repos.length} 个仓库
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column - Activity Feed */}
        <div
          style={{
            width: 320,
            flexShrink: 0,
            background: 'var(--s-raised)',
            border: '1px solid var(--b-faint)',
            borderRadius: 'var(--radius-l)',
            overflow: 'hidden',
            height: 'fit-content',
          }}
        >
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--b-faint)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--t-primary)',
              }}
            >
              最近分析
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--t-muted)',
              }}
            >
              {repos.length} 个
            </div>
          </div>

          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            {reposLoading && (
              <div style={{ padding: '16px 20px' }}>
                <SkeletonTable rows={4} columns={3} />
              </div>
            )}

            {!reposLoading && repos.length === 0 && (
              <div style={{ padding: '32px 20px' }}>
                <EmptyGraph onAddNode={() => navigate('/repository')} />
              </div>
            )}

            {!reposLoading && recentRepos.length > 0 && (
              <div>
                {recentRepos.map((repo, i) => (
                  <ActivityItem
                    key={repo.graphId}
                    repo={repo}
                    index={i}
                    total={recentRepos.length}
                    onNavigate={() => navigate('/architecture')}
                  />
                ))}
              </div>
            )}
          </div>

          {!reposLoading && repos.length > 5 && (
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--b-faint)',
                textAlign: 'center',
              }}
            >
              <span
                onClick={() => navigate('/repository')}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--t-cyan)',
                  cursor: 'pointer',
                }}
              >
                查看全部
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Dashboard
