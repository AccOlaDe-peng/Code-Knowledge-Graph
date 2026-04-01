import React, { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ConfigProvider, Spin } from "antd";
import zhCN from "antd/locale/zh_CN";
import MainLayout from "./layouts/MainLayout";
import { antdTheme } from "./theme";
import { useMetaStore } from "./store/metaStore";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Repository = lazy(() => import("./pages/Repository"));
const DataLineage = lazy(() => import("./pages/DataLineage"));
const FieldLineage = lazy(() => import("./pages/FieldLineage"));
const FunctionCallGraph = lazy(() => import("./pages/FunctionCallGraph"));

// New feature modules
const ArchitectureExplorer = lazy(() => import("./features/architecture"));

const PageLoader: React.FC = () => (
  <div
    style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: "50vh",
    }}
  >
    <Spin
      indicator={
        <span style={{ fontSize: 28, color: "var(--a-cyan)" }}>◈</span>
      }
    />
  </div>
);

const wrap = (C: React.ComponentType) => (
  <Suspense fallback={<PageLoader />}>
    <C />
  </Suspense>
);

const App: React.FC = () => {
  useEffect(() => {
    const fetchMeta = useMetaStore.getState().fetchNodeTypes;
    void fetchMeta();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void fetchMeta();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return (
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={wrap(Dashboard)} />
            <Route path="repository" element={wrap(Repository)} />
            <Route path="architecture" element={wrap(ArchitectureExplorer)} />
            <Route path="lineage" element={wrap(DataLineage)} />
            <Route path="fieldlineage" element={wrap(FieldLineage)} />
            <Route path="callgraph" element={wrap(FunctionCallGraph)} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
};

export default App;
