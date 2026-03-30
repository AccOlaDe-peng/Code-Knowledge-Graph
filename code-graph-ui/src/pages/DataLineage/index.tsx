/**
 * DataLineage - 数据血缘主页面。
 *
 * 使用 data-lineage.json 作为数据源：
 * - 首屏展示模块依赖图
 * - 点击模块展开详情面板
 * - 详情面板包含：实体、业务流程、功能三个 Tab
 */
import React, { useEffect, useState, useCallback } from "react";
import { ReactFlowProvider } from "reactflow";
import "reactflow/dist/style.css";
import { Spin, Button, Tooltip } from "antd";
import { ReloadOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { getDataLineage } from "../../api/dataLineageApi";
import ModuleGraph from "./components/ModuleGraph";
import ModuleDetailPanel from "./components/ModuleDetailPanel";
import type { DataLineageJSON, Module } from "./types/dataLineage";

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const DataLineageInner: React.FC = () => {
  // 数据状态
  const [data, setData] = useState<DataLineageJSON | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI 状态
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await getDataLineage();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 处理模块点击
  const handleModuleClick = useCallback((module: Module) => {
    setSelectedModule((prev) =>
      prev?.id === module.id ? null : module
    );
    if (selectedModule?.id !== module.id) {
      setPanelCollapsed(false);
    }
  }, [selectedModule?.id]);

  // 重置视图
  const handleReset = useCallback(() => {
    setSelectedModule(null);
    setPanelCollapsed(false);
  }, []);

  // 统计信息
  const stats = data
    ? {
        moduleCount: data.modules.length,
        entityCount: data.modules.reduce((sum, m) => sum + m.entities.length, 0),
        flowCount: data.modules.reduce((sum, m) => sum + m.businessFlows.length, 0),
        dependencyCount: data.moduleDependencies.dependencies.length,
      }
    : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#07090d",
      }}
    >
      {/* 工具栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          background: "rgba(6,8,12,0.97)",
          backdropFilter: "blur(12px)",
          flexShrink: 0,
        }}
      >
        {/* 标题 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: 2,
              background: "#b08eff",
              boxShadow: "0 0 12px #b08effaa",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 15,
              fontWeight: 700,
              color: "#b08eff",
              letterSpacing: "0.04em",
            }}
          >
            数据血缘
          </span>
        </div>

        {/* 统计 */}
        {stats && (
          <div style={{ display: "flex", gap: 20, marginRight: "auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#b08eff",
                }}
              >
                {stats.moduleCount}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  color: "#7888a8",
                }}
              >
                模块
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#00d4ff",
                }}
              >
                {stats.entityCount}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  color: "#7888a8",
                }}
              >
                实体
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#ffc145",
                }}
              >
                {stats.flowCount}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  color: "#7888a8",
                }}
              >
                业务流程
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#00f084",
                }}
              >
                {stats.dependencyCount}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  color: "#7888a8",
                }}
              >
                依赖关系
              </span>
            </div>
          </div>
        )}

        {/* 信息提示 */}
        <Tooltip title={data?.meta.description || ""}>
          <InfoCircleOutlined style={{ color: "#5a6a8a", fontSize: 14 }} />
        </Tooltip>

        {/* 重置按钮 */}
        <Tooltip title="重置视图">
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            size="small"
            style={{
              background: "var(--s-float)",
              border: "1px solid var(--b-subtle)",
              color: "#7888a8",
            }}
          />
        </Tooltip>
      </div>

      {/* 主内容区 */}
      <div
        style={{
          flex: 1,
          display: "flex",
          position: "relative",
          overflow: "hidden",
          flexDirection: "column",
        }}
      >
        {/* 加载状态 */}
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(6,8,12,0.85)",
              zIndex: 10,
              gap: 14,
            }}
          >
            <Spin size="large" />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "#7888a8",
                letterSpacing: "0.04em",
              }}
            >
              加载数据血缘...
            </span>
          </div>
        )}

        {/* 错误状态 */}
        {error && !loading && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
            }}
          >
            <div style={{ color: "#ff6b6b", fontSize: 28 }}>⚠️</div>
            <div
              style={{
                color: "#ff6b6b",
                fontFamily: "var(--font-mono)",
                fontSize: 13,
              }}
            >
              加载失败: {error}
            </div>
            <Button onClick={loadData} size="small">
              重试
            </Button>
          </div>
        )}

        {/* 主视图 */}
        {data && !loading && !error && (
          <>
            {/* 模块依赖图 */}
            <div style={{ flex: 1, position: "relative" }}>
              <ModuleGraph
                modules={data.modules}
                dependencies={data.moduleDependencies.dependencies}
                selectedModuleId={selectedModule?.id}
                onModuleClick={handleModuleClick}
              />
            </div>

            {/* 模块详情面板 */}
            <ModuleDetailPanel
              module={selectedModule}
              collapsed={panelCollapsed}
              onCollapseChange={setPanelCollapsed}
            />
          </>
        )}
      </div>
    </div>
  );
};

// ─── 导出组件 ────────────────────────────────────────────────────────────────

const DataLineage: React.FC = () => (
  <ReactFlowProvider>
    <DataLineageInner />
  </ReactFlowProvider>
);

export default DataLineage;
