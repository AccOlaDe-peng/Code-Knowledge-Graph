import React from 'react';
import { Table, Tag, Empty } from 'antd';
import { useRepoStore } from '../../store/repoStore';
import type { RepoInfo } from '../../types/api';
import type { ColumnsType } from 'antd/es/table';

/* ── Metric Card ─────────────────────────────────────────── */
interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
  icon: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, sub, accent, icon }) => (
  <div style={{
    background: 'var(--s-raised)',
    border: '1px solid var(--b-faint)',
    borderTop: `2px solid ${accent}`,
    borderRadius: 'var(--radius-m)',
    padding: '20px 22px',
    position: 'relative', overflow: 'hidden',
    flex: 1, minWidth: 0,
  }}>
    {/* bg glow */}
    <div style={{
      position: 'absolute', top: -40, right: -40,
      width: 120, height: 120, borderRadius: '50%',
      background: `radial-gradient(circle, ${accent}18 0%, transparent 70%)`,
      pointerEvents: 'none',
    }} />
    <div style={{ fontSize: 22, marginBottom: 12, lineHeight: 1 }}>{icon}</div>
    <div style={{
      fontFamily: 'var(--font-mono)', fontWeight: 500,
      fontSize: 32, lineHeight: 1, color: 'var(--t-primary)',
      letterSpacing: '-0.02em',
    }}>
      {typeof value === 'number' ? value.toLocaleString() : value}
    </div>
    <div style={{
      fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
      letterSpacing: '0.12em', color: 'var(--t-muted)', marginTop: 8,
    }}>{label}</div>
    {sub && (
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: accent, marginTop: 4 }}>{sub}</div>
    )}
  </div>
);

/* ── Table columns ───────────────────────────────────────── */
const columns: ColumnsType<RepoInfo> = [
  {
    title: 'REPOSITORY',
    dataIndex: 'repoName',
    key: 'repoName',
    render: (name: string) => (
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--t-cyan)', fontSize: 13 }}>
        {name}
      </span>
    ),
  },
  {
    title: 'LANGUAGES',
    dataIndex: 'language',
    key: 'language',
    render: (langs: string[]) => (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {langs?.map((l) => <Tag color="blue" key={l}>{l}</Tag>)}
      </div>
    ),
  },
  {
    title: 'NODES',
    dataIndex: 'nodeCount',
    key: 'nodeCount',
    sorter: (a, b) => a.nodeCount - b.nodeCount,
    render: (v: number) => (
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--t-cyan)', fontWeight: 500 }}>
        {v.toLocaleString()}
      </span>
    ),
  },
  {
    title: 'EDGES',
    dataIndex: 'edgeCount',
    key: 'edgeCount',
    sorter: (a, b) => a.edgeCount - b.edgeCount,
    render: (v: number) => (
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--t-green)', fontWeight: 500 }}>
        {v.toLocaleString()}
      </span>
    ),
  },
  {
    title: 'COMMIT',
    dataIndex: 'gitCommit',
    key: 'gitCommit',
    render: (c?: string) => c
      ? <Tag color="orange" style={{ fontFamily: 'var(--font-mono)' }}>{c.slice(0, 7)}</Tag>
      : <span style={{ color: 'var(--t-muted)' }}>—</span>,
  },
  {
    title: 'ANALYZED',
    dataIndex: 'createdAt',
    key: 'createdAt',
    render: (d: string) => (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--t-secondary)' }}>
        {new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </span>
    ),
  },
];

/* ── Dashboard ───────────────────────────────────────────── */
const Dashboard: React.FC = () => {
  const { repos, loading } = useRepoStore();
  const totalNodes = repos.reduce((s, r) => s + r.nodeCount, 0);
  const totalEdges = repos.reduce((s, r) => s + r.edgeCount, 0);
  const lastUpdated = repos.length > 0
    ? new Date(repos[0].createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    : '—';

  return (
    <div>
      {/* Page heading */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4 }}>
          SYS / OVERVIEW
        </div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--t-primary)', fontFamily: 'var(--font-ui)', letterSpacing: '-0.01em' }}>
          System Dashboard
        </h2>
      </div>

      {/* Metrics row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <MetricCard icon="⬡" label="Repositories"  value={repos.length}  accent="#00d4ff" />
        <MetricCard icon="◈" label="Total Nodes"    value={totalNodes}    accent="#00f084" sub={totalNodes > 0 ? `across ${repos.length} repo${repos.length !== 1 ? 's' : ''}` : undefined} />
        <MetricCard icon="⇢" label="Total Edges"    value={totalEdges}    accent="#b08eff" />
        <MetricCard icon="⊙" label="Last Analyzed"  value={lastUpdated}   accent="#ffc145" />
      </div>

      {/* Repos table */}
      <div style={{
        background: 'var(--s-raised)',
        border: '1px solid var(--b-faint)',
        borderRadius: 'var(--radius-m)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--b-faint)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--t-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Analyzed Repositories
          </span>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)' }}>
            {repos.length} record{repos.length !== 1 ? 's' : ''}
          </span>
        </div>

        {repos.length === 0 && !loading ? (
          <div style={{ padding: '48px 0' }}>
            <Empty
              description={
                <span style={{ color: 'var(--t-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  no repos — navigate to /repository to analyze
                </span>
              }
            />
          </div>
        ) : (
          <Table
            columns={columns}
            dataSource={repos}
            rowKey="graphId"
            loading={loading}
            pagination={{ pageSize: 10, size: 'small' }}
            style={{ background: 'transparent' }}
          />
        )}
      </div>
    </div>
  );
};

export default Dashboard;
