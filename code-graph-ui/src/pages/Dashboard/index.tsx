import React, { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from 'antd'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { useGraphStore } from '../../store/graphStore'
import { useRepoStore } from '../../store/repoStore'
import type { GraphNode, GraphEdge } from '../../types/graph'

// ─── Stat Card ────────────────────────────────────────────────────────────────

type StatCardProps = {
  icon:   string
  label:  string
  value:  number
  color:  string
  trend?: string
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, color, trend }) => (
  <div style={{
    background:    'linear-gradient(135deg, var(--s-raised) 0%, rgba(15,18,24,0.8) 100%)',
    border:        '1px solid var(--b-faint)',
    borderTop:     `3px solid ${color}`,
    borderRadius:  'var(--radius-m)',
    padding:       '24px 24px',
    position:      'relative',
    overflow:      'hidden',
    flex:          1,
    minWidth:      160,
    cursor:        'default',
    transition:    'all 0.2s',
  }}
  onMouseEnter={e => {
    e.currentTarget.style.borderTopColor = color
    e.currentTarget.style.transform = 'translateY(-3px)'
    e.currentTarget.style.boxShadow = `0 12px 32px ${color}18`
  }}
  onMouseLeave={e => {
    e.currentTarget.style.transform = 'translateY(0)'
    e.currentTarget.style.boxShadow = 'none'
  }}
  >
    {/* Glow effect */}
    <div style={{
      position:      'absolute',
      top:           -40,
      right:         -40,
      width:         120,
      height:        120,
      borderRadius:  '50%',
      background:    `radial-gradient(circle, ${color}12 0%, transparent 70%)`,
      pointerEvents: 'none',
    }} />

    <div style={{ position: 'relative', zIndex: 1 }}>
      <div style={{
        fontSize: 26,
        marginBottom: 12,
        lineHeight: 1,
        filter: `drop-shadow(0 0 8px ${color}40)`,
      }}>{icon}</div>
      <div style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      36,
        fontWeight:    600,
        color:         'var(--t-primary)',
        lineHeight:    1,
        letterSpacing: '-0.02em',
        marginBottom:  8,
      }}>
        {value.toLocaleString()}
      </div>
      <div style={{
        fontFamily:    'var(--font-ui)',
        fontSize:      13,
        fontWeight: 500,
        color:         'var(--t-secondary)',
        letterSpacing: '0.01em',
      }}>
        {label}
      </div>
      {trend && (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize:   12,
          color,
          marginTop:  8,
        }}>
          {trend}
        </div>
      )}
    </div>
  </div>
)

// ─── Chart Card ───────────────────────────────────────────────────────────────

type ChartCardProps = {
  title:    string
  children: React.ReactNode
}

const ChartCard: React.FC<ChartCardProps> = ({ title, children }) => (
  <div style={{
    background:   'var(--s-raised)',
    border:       '1px solid var(--b-faint)',
    borderRadius: 'var(--radius-m)',
    overflow:     'hidden',
    height:       '100%',
  }}>
    <div style={{
      padding:      '16px 24px',
      borderBottom: '1px solid var(--b-faint)',
    }}>
      <div style={{
        fontFamily:    'var(--font-ui)',
        fontSize:      14,
        fontWeight: 600,
        color:         'var(--t-secondary)',
        letterSpacing: '0.01em',
      }}>
        {title}
      </div>
    </div>
    <div style={{ padding: '24px' }}>
      {children}
    </div>
  </div>
)

// ─── Dashboard ────────────────────────────────────────────────────────────────

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { activeGraphId, fullGraph, loadFullGraph } = useGraphStore()
  const { repos, loading: reposLoading } = useRepoStore()

  useEffect(() => {
    if (activeGraphId) loadFullGraph(activeGraphId)
  }, [activeGraphId, loadFullGraph])

  const nodes: GraphNode[] = fullGraph.data?.nodes ?? []
  const edges: GraphEdge[] = fullGraph.data?.edges ?? []

  // ── Compute node type counts ──────────────────────────────────────────────

  const nodeTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    nodes.forEach(n => {
      counts[n.type] = (counts[n.type] ?? 0) + 1
    })
    return counts
  }, [nodes])

  const edgeTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    edges.forEach(e => {
      counts[e.type] = (counts[e.type] ?? 0) + 1
    })
    return counts
  }, [edges])

  const moduleCount   = nodeTypeCounts.Module ?? 0
  const functionCount = nodeTypeCounts.Function ?? 0
  const apiCount      = nodeTypeCounts.API ?? 0
  const tableCount    = nodeTypeCounts.Database ?? 0
  const eventCount    = nodeTypeCounts.Event ?? 0

  // ── ECharts: Node type distribution (pie) ─────────────────────────────────

  const pieOption: EChartsOption = useMemo(() => {
    const data = Object.entries(nodeTypeCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1a1f2a',
        borderColor: '#00d4ff',
        textStyle: {
          color: '#f0f4fc',
          fontFamily: 'JetBrains Mono',
          fontSize: 13,
        },
      },
      legend: { show: false },
      series: [{
        type: 'pie',
        radius: ['42%', '72%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: '#06080c',
          borderWidth: 3,
        },
        label: {
          show: true,
          position: 'outside',
          formatter: '{b}\n{c}',
          color: '#a8b8d8',
          fontFamily: 'JetBrains Mono',
          fontSize: 12,
        },
        labelLine: {
          show: true,
          lineStyle: { color: '#7888a8' },
          length: 12,
          length2: 8,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 16,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0,212,255,0.35)',
          },
        },
        data,
        color: ['#00d4ff', '#00f084', '#ffc145', '#b08eff', '#ff6b6b', '#7ed957', '#ffcc44', '#44aaff'],
      }],
    }
  }, [nodeTypeCounts])

  // ── ECharts: Edge type distribution (bar) ─────────────────────────────────

  const barOption: EChartsOption = useMemo(() => {
    const entries = Object.entries(edgeTypeCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    const xData = entries.map(([name]) => name)
    const yData = entries.map(([, value]) => value)

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1a1f2a',
        borderColor: '#00f084',
        textStyle: {
          color: '#f0f4fc',
          fontFamily: 'JetBrains Mono',
          fontSize: 13,
        },
      },
      grid: { left: 56, right: 24, top: 24, bottom: 48 },
      xAxis: {
        type: 'category',
        data: xData,
        axisLine: { lineStyle: { color: '#7888a8' } },
        axisLabel: {
          color: '#7888a8',
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
          rotate: 25,
        },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#2a3a4a', type: 'dashed' } },
        axisLabel: {
          color: '#7888a8',
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
        },
      },
      series: [{
        type: 'bar',
        data: yData,
        itemStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#00f084' },
              { offset: 1, color: '#00f08435' },
            ],
          },
          borderRadius: [5, 5, 0, 0],
        },
        emphasis: { itemStyle: { color: '#00f084' } },
        barWidth: '55%',
      }],
    }
  }, [edgeTypeCounts])

  // ── Recent tasks ──────────────────────────────────────────────────────────

  const recentRepos = repos.slice(0, 5)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <div>
        <div style={{
          fontSize:      12,
          fontFamily:    'var(--font-mono)',
          color:         'var(--t-muted)',
          letterSpacing: '0.1em',
          marginBottom:  6,
        }}>
          系统 / 概览
        </div>
        <h2 style={{
          margin:        0,
          fontSize:      28,
          fontWeight:    700,
          color:         'var(--t-primary)',
          fontFamily:    'var(--font-ui)',
          letterSpacing: '-0.01em',
        }}>
          任务控制台
        </h2>
      </div>

      {/* ── No repo selected ──────────────────────────────────────────────── */}
      {!activeGraphId && (
        <Alert
          type="info"
          message="请从顶栏选择一个仓库以查看详细统计信息"
          showIcon
          style={{ borderRadius: 8, fontSize: 14 }}
        />
      )}

      {/* ── Stats grid ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <StatCard icon="◫" label="模块"   value={moduleCount}   color="#00d4ff" />
        <StatCard icon="ƒ"  label="函数" value={functionCount} color="#ffc145" />
        <StatCard icon="⇌" label="接口"  value={apiCount}      color="#ff6b6b" />
        <StatCard icon="⊞" label="数据表" value={tableCount}  color="#b08eff" />
        <StatCard icon="⚡" label="事件"  value={eventCount}   color="#ffcc44" />
      </div>

      {/* ── Charts row ────────────────────────────────────────────────────── */}
      {activeGraphId && nodes.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <ChartCard title="节点类型分布">
            <ReactECharts option={pieOption} style={{ height: 300 }} />
          </ChartCard>
          <ChartCard title="边类型分布">
            <ReactECharts option={barOption} style={{ height: 300 }} />
          </ChartCard>
        </div>
      )}

      {/* ── Recent analysis tasks ─────────────────────────────────────────── */}
      <div style={{
        background:   'var(--s-raised)',
        border:       '1px solid var(--b-faint)',
        borderRadius: 'var(--radius-m)',
        overflow:     'hidden',
      }}>
        <div style={{
          padding:      '16px 24px',
          borderBottom: '1px solid var(--b-faint)',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'space-between',
        }}>
          <div style={{
            fontFamily:    'var(--font-ui)',
            fontSize:      14,
            fontWeight: 600,
            color:         'var(--t-secondary)',
            letterSpacing: '0.01em',
          }}>
            最近分析任务
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   12,
            color:      'var(--t-muted)',
          }}>
            共 {repos.length} 个
          </div>
        </div>

        {reposLoading && (
          <div style={{
            padding:        '48px',
            textAlign:      'center',
            color:          'var(--t-muted)',
            fontFamily:     'var(--font-mono)',
            fontSize:       13,
            letterSpacing:  '0.04em',
          }}>
            加载中…
          </div>
        )}

        {!reposLoading && repos.length === 0 && (
          <div style={{
            padding:        '48px',
            textAlign:      'center',
            color:          'var(--t-muted)',
            fontFamily:     'var(--font-mono)',
            fontSize:       13,
            letterSpacing:  '0.04em',
          }}>
            暂无分析任务
          </div>
        )}

        {!reposLoading && recentRepos.length > 0 && (
          <div style={{ padding: '16px 20px' }}>
            {recentRepos.map((repo, i) => (
              <div
                key={repo.graphId}
                onClick={() => navigate('/architecture')}
                style={{
                  display:       'flex',
                  alignItems:    'center',
                  gap:           16,
                  padding:       '14px 18px',
                  marginBottom:  i < recentRepos.length - 1 ? 8 : 0,
                  background:    'var(--s-float)',
                  border:        '1px solid var(--b-faint)',
                  borderRadius:  6,
                  cursor:        'pointer',
                  transition:    'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'rgba(0,212,255,0.35)'
                  e.currentTarget.style.background = 'var(--s-overlay)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--b-faint)'
                  e.currentTarget.style.background = 'var(--s-float)'
                }}
              >
                {/* Timeline dot */}
                <div style={{
                  width:        10,
                  height:       10,
                  borderRadius: '50%',
                  background:   '#00d4ff',
                  boxShadow:    '0 0 10px rgba(0,212,255,0.5)',
                  flexShrink:   0,
                }} />

                {/* Repo name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily:   'var(--font-ui)',
                    fontSize:     15,
                    fontWeight:   600,
                    color:        'var(--t-cyan)',
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace:   'nowrap',
                  }}>
                    {repo.repoName}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize:   12,
                    color:      'var(--t-muted)',
                    marginTop:  3,
                  }}>
                    {repo.nodeCount.toLocaleString()} 节点 · {repo.edgeCount.toLocaleString()} 边
                  </div>
                </div>

                {/* Commit SHA */}
                {repo.gitCommit && (
                  <div style={{
                    fontFamily:    'var(--font-mono)',
                    fontSize:      12,
                    color:         'var(--t-amber)',
                    background:    'rgba(255,193,69,0.1)',
                    border:        '1px solid rgba(255,193,69,0.25)',
                    borderRadius:  4,
                    padding:       '4px 10px',
                    letterSpacing: '0.02em',
                  }}>
                    {repo.gitCommit.slice(0, 7)}
                  </div>
                )}

                {/* Timestamp */}
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize:   12,
                  color:      'var(--t-secondary)',
                  flexShrink: 0,
                  minWidth:   100,
                  textAlign:  'right',
                }}>
                  {new Date(repo.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Empty state for no data ───────────────────────────────────────── */}
      {activeGraphId && nodes.length === 0 && !fullGraph.loading && (
        <div style={{
          background:     'var(--s-raised)',
          border:         '1px solid var(--b-faint)',
          borderRadius:   'var(--radius-m)',
          padding:        '72px 48px',
          textAlign:      'center',
        }}>
          <div style={{ fontSize: 56, opacity: 0.08, marginBottom: 20 }}>◈</div>
          <div style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      14,
            color:         'var(--t-muted)',
            letterSpacing: '0.04em',
          }}>
            暂无图谱数据
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
