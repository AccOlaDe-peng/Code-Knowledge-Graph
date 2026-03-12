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
    background:    'var(--s-raised)',
    border:        '1px solid var(--b-faint)',
    borderTop:     `2px solid ${color}`,
    borderRadius:  'var(--radius-m)',
    padding:       '18px 20px',
    position:      'relative',
    overflow:      'hidden',
    flex:          1,
    minWidth:      140,
    cursor:        'default',
    transition:    'all 0.2s',
  }}
  onMouseEnter={e => {
    e.currentTarget.style.borderTopColor = color
    e.currentTarget.style.transform = 'translateY(-2px)'
    e.currentTarget.style.boxShadow = `0 8px 24px ${color}22`
  }}
  onMouseLeave={e => {
    e.currentTarget.style.transform = 'translateY(0)'
    e.currentTarget.style.boxShadow = 'none'
  }}
  >
    {/* Glow effect */}
    <div style={{
      position:      'absolute',
      top:           -30,
      right:         -30,
      width:         100,
      height:        100,
      borderRadius:  '50%',
      background:    `radial-gradient(circle, ${color}15 0%, transparent 70%)`,
      pointerEvents: 'none',
    }} />

    <div style={{ position: 'relative', zIndex: 1 }}>
      <div style={{ fontSize: 20, marginBottom: 10, lineHeight: 1 }}>{icon}</div>
      <div style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      28,
        fontWeight:    600,
        color:         'var(--t-primary)',
        lineHeight:    1,
        letterSpacing: '-0.02em',
        marginBottom:  6,
      }}>
        {value.toLocaleString()}
      </div>
      <div style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      9,
        color:         'var(--t-muted)',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}>
        {label}
      </div>
      {trend && (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize:   10,
          color,
          marginTop:  4,
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
      padding:      '14px 20px',
      borderBottom: '1px solid var(--b-faint)',
    }}>
      <div style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      10,
        color:         'var(--t-secondary)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
      }}>
        {title}
      </div>
    </div>
    <div style={{ padding: '20px' }}>
      {children}
    </div>
  </div>
)

// ─── Dashboard ────────────────────────────────────────────────────────────────

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { activeGraphId, graph, loadGraph } = useGraphStore()
  const { repos, loading: reposLoading } = useRepoStore()

  useEffect(() => {
    if (activeGraphId) loadGraph(activeGraphId)
  }, [activeGraphId, loadGraph])

  const nodes: GraphNode[] = graph.data?.nodes ?? []
  const edges: GraphEdge[] = graph.data?.edges ?? []

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
      tooltip: { trigger: 'item', backgroundColor: '#1e2234', borderColor: '#00d4ff', textStyle: { color: '#e8ecf8', fontFamily: 'IBM Plex Mono' } },
      legend: { show: false },
      series: [{
        type: 'pie',
        radius: ['45%', '70%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 4, borderColor: '#0c0f16', borderWidth: 2 },
        label: {
          show: true,
          position: 'outside',
          formatter: '{b}\n{c}',
          color: '#9ba8c8',
          fontFamily: 'IBM Plex Mono',
          fontSize: 10,
        },
        labelLine: { show: true, lineStyle: { color: '#6b7a9d' } },
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,212,255,0.3)' } },
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
      tooltip: { trigger: 'axis', backgroundColor: '#1e2234', borderColor: '#00f084', textStyle: { color: '#e8ecf8', fontFamily: 'IBM Plex Mono' } },
      grid: { left: 50, right: 20, top: 20, bottom: 40 },
      xAxis: {
        type: 'category',
        data: xData,
        axisLine: { lineStyle: { color: '#6b7a9d' } },
        axisLabel: { color: '#6e7a99', fontFamily: 'IBM Plex Mono', fontSize: 10, rotate: 20 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#6b7a9d', type: 'dashed' } },
        axisLabel: { color: '#6e7a99', fontFamily: 'IBM Plex Mono', fontSize: 10 },
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
              { offset: 1, color: '#00f08440' },
            ],
          },
          borderRadius: [4, 4, 0, 0],
        },
        emphasis: { itemStyle: { color: '#00f084' } },
        barWidth: '60%',
      }],
    }
  }, [edgeTypeCounts])

  // ── Recent tasks ──────────────────────────────────────────────────────────

  const recentRepos = repos.slice(0, 5)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <div>
        <div style={{
          fontSize:      9,
          fontFamily:    'var(--font-mono)',
          color:         'var(--t-muted)',
          letterSpacing: '0.15em',
          marginBottom:  4,
        }}>
          系统 / 概览
        </div>
        <h2 style={{
          margin:        0,
          fontSize:      22,
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
          style={{ borderRadius: 4 }}
        />
      )}

      {/* ── Stats grid ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard icon="◫" label="模块"   value={moduleCount}   color="#00d4ff" />
        <StatCard icon="ƒ"  label="函数" value={functionCount} color="#ffc145" />
        <StatCard icon="⇌" label="接口"  value={apiCount}      color="#ff6b6b" />
        <StatCard icon="⊞" label="数据表" value={tableCount}  color="#b08eff" />
        <StatCard icon="⚡" label="事件"  value={eventCount}   color="#ffcc44" />
      </div>

      {/* ── Charts row ────────────────────────────────────────────────────── */}
      {activeGraphId && nodes.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <ChartCard title="节点类型分布">
            <ReactECharts option={pieOption} style={{ height: 280 }} />
          </ChartCard>
          <ChartCard title="边类型分布">
            <ReactECharts option={barOption} style={{ height: 280 }} />
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
          padding:      '14px 20px',
          borderBottom: '1px solid var(--b-faint)',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'space-between',
        }}>
          <div style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      10,
            color:         'var(--t-secondary)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            最近分析任务
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   10,
            color:      'var(--t-muted)',
          }}>
            共 {repos.length} 个
          </div>
        </div>

        {reposLoading && (
          <div style={{
            padding:        '40px',
            textAlign:      'center',
            color:          'var(--t-muted)',
            fontFamily:     'var(--font-mono)',
            fontSize:       11,
            letterSpacing:  '0.1em',
          }}>
            加载中…
          </div>
        )}

        {!reposLoading && repos.length === 0 && (
          <div style={{
            padding:        '40px',
            textAlign:      'center',
            color:          'var(--t-muted)',
            fontFamily:     'var(--font-mono)',
            fontSize:       11,
            letterSpacing:  '0.1em',
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
                  padding:       '12px 16px',
                  marginBottom:  i < recentRepos.length - 1 ? 8 : 0,
                  background:    'var(--s-float)',
                  border:        '1px solid var(--b-faint)',
                  borderRadius:  4,
                  cursor:        'pointer',
                  transition:    'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'rgba(0,212,255,0.3)'
                  e.currentTarget.style.background = 'var(--s-overlay)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--b-faint)'
                  e.currentTarget.style.background = 'var(--s-float)'
                }}
              >
                {/* Timeline dot */}
                <div style={{
                  width:        8,
                  height:       8,
                  borderRadius: '50%',
                  background:   '#00d4ff',
                  flexShrink:   0,
                }} />

                {/* Repo name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily:   'var(--font-mono)',
                    fontSize:     13,
                    fontWeight:   500,
                    color:        'var(--t-cyan)',
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace:   'nowrap',
                  }}>
                    {repo.repoName}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize:   10,
                    color:      'var(--t-muted)',
                    marginTop:  2,
                  }}>
                    {repo.nodeCount.toLocaleString()} 节点 · {repo.edgeCount.toLocaleString()} 边
                  </div>
                </div>

                {/* Commit SHA */}
                {repo.gitCommit && (
                  <div style={{
                    fontFamily:    'var(--font-mono)',
                    fontSize:      10,
                    color:         'var(--t-amber)',
                    background:    'rgba(255,193,69,0.08)',
                    border:        '1px solid rgba(255,193,69,0.2)',
                    borderRadius:  3,
                    padding:       '2px 8px',
                    letterSpacing: '0.02em',
                  }}>
                    {repo.gitCommit.slice(0, 7)}
                  </div>
                )}

                {/* Timestamp */}
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize:   10,
                  color:      'var(--t-secondary)',
                  flexShrink: 0,
                  minWidth:   80,
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
      {activeGraphId && nodes.length === 0 && !graph.loading && (
        <div style={{
          background:     'var(--s-raised)',
          border:         '1px solid var(--b-faint)',
          borderRadius:   'var(--radius-m)',
          padding:        '60px 40px',
          textAlign:      'center',
        }}>
          <div style={{ fontSize: 48, opacity: 0.1, marginBottom: 16 }}>◈</div>
          <div style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      11,
            color:         'var(--t-muted)',
            letterSpacing: '0.1em',
          }}>
            暂无图谱数据
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
