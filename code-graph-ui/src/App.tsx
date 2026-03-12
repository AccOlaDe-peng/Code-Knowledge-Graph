import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import MainLayout from './layouts/MainLayout';
import { antdTheme } from './theme';

const Dashboard     = lazy(() => import('./pages/Dashboard'));
const Repository    = lazy(() => import('./pages/Repository'));
const Architecture  = lazy(() => import('./pages/Architecture'));
const CallGraph     = lazy(() => import('./pages/CallGraph'));
const DataLineage   = lazy(() => import('./pages/DataLineage'));
const EventFlow     = lazy(() => import('./pages/EventFlow'));
const GraphQuery    = lazy(() => import('./pages/GraphQuery'));
const ImpactAnalysis = lazy(() => import('./pages/ImpactAnalysis'));

const PageLoader: React.FC = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
    <Spin indicator={<span style={{ fontSize: 28, color: 'var(--a-cyan)' }}>◈</span>} />
  </div>
);

const wrap = (C: React.ComponentType) => (
  <Suspense fallback={<PageLoader />}><C /></Suspense>
);

const App: React.FC = () => (
  <ConfigProvider
    locale={zhCN}
    theme={antdTheme}
  >
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index                  element={wrap(Dashboard)} />
          <Route path="repository"      element={wrap(Repository)} />
          <Route path="architecture"    element={wrap(Architecture)} />
          <Route path="callgraph"       element={wrap(CallGraph)} />
          <Route path="lineage"         element={wrap(DataLineage)} />
          <Route path="eventflow"       element={wrap(EventFlow)} />
          <Route path="query"           element={wrap(GraphQuery)} />
          <Route path="impact"          element={wrap(ImpactAnalysis)} />
        </Route>
      </Routes>
    </BrowserRouter>
  </ConfigProvider>
);

export default App;
