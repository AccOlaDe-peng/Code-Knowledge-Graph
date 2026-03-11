import React from 'react';
import { Select } from 'antd';
import { useRepoStore } from '../store/repoStore';
import { useGraphStore } from '../store/graphStore';

const Chip: React.FC<{ label: string; value: string | number; color?: string }> = ({ label, value, color = '#00d4ff' }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '3px 10px', borderRadius: 3,
    background: `rgba(${color === '#00d4ff' ? '0,212,255' : color === '#00f084' ? '0,240,132' : '255,193,69'},0.08)`,
    border: `1px solid rgba(${color === '#00d4ff' ? '0,212,255' : color === '#00f084' ? '0,240,132' : '255,193,69'},0.2)`,
  }}>
    <span style={{ fontSize: 9, color: 'var(--t-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
    <span style={{ fontSize: 12, color, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{value}</span>
  </div>
);

const Header: React.FC = () => {
  const { repos, activeRepo, setActiveRepo } = useRepoStore();
  const { setActiveGraphId } = useGraphStore();

  const handleChange = (graphId: string) => {
    const repo = repos.find((r) => r.graphId === graphId) ?? null;
    setActiveRepo(repo);
    setActiveGraphId(graphId);
  };

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 100, height: 54,
      background: '#0a0d13',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      display: 'flex', alignItems: 'center',
      padding: '0 24px',
      justifyContent: 'space-between',
      gap: 16,
    }}>

      {/* Left — repo selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
          ACTIVE REPO
        </span>
        <Select
          placeholder="— select repository —"
          style={{ width: 260 }}
          value={activeRepo?.graphId ?? undefined}
          onChange={handleChange}
          variant="borderless"
          popupMatchSelectWidth={false}
          options={repos.map((r) => ({
            value: r.graphId,
            label: (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--t-primary)' }}>
                {r.repoName}
                <span style={{ color: 'var(--t-muted)', marginLeft: 8, fontSize: 11 }}>
                  /{r.graphId.slice(0, 8)}
                </span>
              </span>
            ),
          }))}
          notFoundContent={
            <span style={{ color: 'var(--t-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              no repos — go to /repository
            </span>
          }
          styles={{ popup: { root: { minWidth: 320 } } }}
        />
      </div>

      {/* Right — stats */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {activeRepo ? (
          <>
            <Chip label="NODES" value={activeRepo.nodeCount.toLocaleString()} color="#00d4ff" />
            <Chip label="EDGES" value={activeRepo.edgeCount.toLocaleString()} color="#00f084" />
            {activeRepo.gitCommit && (
              <Chip label="SHA" value={activeRepo.gitCommit.slice(0, 7)} color="#ffc145" />
            )}
          </>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--t-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
            NO REPO SELECTED
          </span>
        )}
      </div>
    </header>
  );
};

export default Header;
