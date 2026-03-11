import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider, Spin, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import MainLayout from './layouts/MainLayout';

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
    theme={{
      algorithm: theme.darkAlgorithm,
      token: {
        colorPrimary:          '#00d4ff',
        colorSuccess:          '#00f084',
        colorWarning:          '#ffc145',
        colorError:            '#ff4568',
        colorInfo:             '#00d4ff',
        colorBgBase:           '#0c0f16',
        colorBgContainer:      '#111520',
        colorBgElevated:       '#1e2234',
        colorBgSpotlight:      '#171b28',
        colorBorder:           'rgba(255,255,255,0.1)',
        colorBorderSecondary:  'rgba(255,255,255,0.06)',
        colorText:             '#d0d5e8',
        colorTextSecondary:    '#6e7a99',
        colorTextTertiary:     '#3d4460',
        fontFamily:            "'Syne', -apple-system, sans-serif",
        fontSize:              14,
        borderRadius:          4,
        lineHeight:            1.6,
      },
      components: {
        Layout: { siderBg: '#0a0d13', headerBg: '#0a0d13', bodyBg: '#07090d' },
        Menu: {
          darkItemBg:           '#0a0d13',
          darkSubMenuItemBg:    '#0a0d13',
          darkItemSelectedBg:   'rgba(0,212,255,0.1)',
          darkItemHoverBg:      'rgba(255,255,255,0.04)',
          darkItemColor:        '#6e7a99',
          darkItemSelectedColor:'#00d4ff',
        },
        Table: { rowHoverBg: '#171b28', borderColor: 'rgba(255,255,255,0.05)' },
      },
    }}
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
