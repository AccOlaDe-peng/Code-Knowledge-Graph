import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useRepoStore } from '../store/repoStore';
import { graphApi } from '../api/graphApi';

const SIDEBAR_W = 244;

const MainLayout: React.FC = () => {
  const { setRepos, setLoading, setError } = useRepoStore();
  const [sidebarW, setSidebarW] = useState(SIDEBAR_W);

  // keep sidebar width in sync (sidebar uses its own collapsed state)
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const aside = document.querySelector('aside');
      if (aside) setSidebarW(aside.offsetWidth);
    });
    const aside = document.querySelector('aside');
    if (aside) obs.observe(aside, { attributes: true, attributeFilter: ['style'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await graphApi.listGraphs();
        setRepos(res.graphs || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载仓库列表失败');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [setRepos, setLoading, setError]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--s-void)' }}>
      <Sidebar />
      <div style={{
        flex: 1,
        marginLeft: sidebarW,
        transition: 'margin-left 0.22s cubic-bezier(0.4,0,0.2,1)',
        display: 'flex', flexDirection: 'column',
        minHeight: '100vh',
      }}>
        <Header />
        <main
          className="dot-grid page-enter"
          style={{
            flex: 1,
            padding: '28px 28px 40px',
            minHeight: 'calc(100vh - 54px)',
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
