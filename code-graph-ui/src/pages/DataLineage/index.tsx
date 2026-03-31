/**
 * DataLineage - 数据血缘主页面。
 *
 * 展示模块依赖图：
 * - 首屏需要选择仓库
 * - 展示模块级血缘图
 * - 点击模块展开详情面板
 */
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { ReactFlowProvider } from "reactflow";
import "reactflow/dist/style.css";
import { Spin, Button, Tooltip, Empty } from "antd";
import { ReloadOutlined, InfoCircleOutlined, InboxOutlined } from "@ant-design/icons";
import RepoSelector from "../../components/ui/RepoSelector";
import { graphEndpoints } from "../../core/api";
import { useRepoStore } from "../../store/repoStore";
import ModuleGraph from "./components/ModuleGraph";
import ModuleDetailPanel from "./components/ModuleDetailPanel";
import type { Module, ModuleDependency } from "./types/dataLineage";
import type { LineageModule, LineageModuleEdge } from "../../types/api";

// ─── 数据转换函数 ──────────────────────────────────────────────────────────────

/** 将后端 LineageModule 转换为前端 Module 格式 */
function transformModule(m: LineageModule, index: number): Module {
  // 根据索引分配颜色
  const colors = ["#b08eff", "#00d4ff", "#00f084", "#ffc145", "#ff6b9d", "#36f7c8"];
  const color = colors[index % colors.length];

  // 根据 service 数量估算布局位置
  const cols = Math.ceil(Math.sqrt(m.service_count || 1));
  const row = Math.floor(index / cols);
  const col = index % cols;

  return {
    id: m.id,
    name: m.name,
    fullName: m.name,
    description: `${m.name} 模块 - ${m.service_count} 个服务`,
    icon: "module",
    position: { x: col * 280, y: row * 150 },
    color,
    entities: [], // 暂不展示实体
    businessFlows: [], // 暂不展示业务流程
    subFunctions: m.services.map((s, i) => ({
      id: s.id,
      name: s.name,
      description: `${s.name} 服务`,
      apiEndpoint: "",
      inputSource: [],
      outputTarget: [],
      relatedEntities: [],
      relatedServices: [],
      relatedDAO: [],
    })),
  };
}

/** 将后端 LineageModuleEdge 转换为前端 ModuleDependency 格式 */
function transformEdge(e: LineageModuleEdge): ModuleDependency {
  const typeMap: Record<string, ModuleDependency["type"]> = {
    flow_to: "data",
    calls: "service",
    depends_on: "config",
  };
  return {
    from: e.from,
    to: e.to,
    type: typeMap[e.type] || "data",
    description: `${e.call_count || 0} 次调用`,
  };
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const DataLineageInner: React.FC = () => {
  // 仓库状态
  const { activeRepo } = useRepoStore();

  // 数据状态
  const [modules, setModules] = useState<Module[]>([]);
  const [dependencies, setDependencies] = useState<ModuleDependency[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI 状态
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // 防止 Strict Mode 双重请求
  const loadingRef = useRef(false);

  // 加载数据
  const loadData = useCallback(async (repoId: string) => {
    // 防止并发重复请求
    if (loadingRef.current) return;
    loadingRef.current = true;

    setLoading(true);
    setError(null);
    setSelectedModule(null);

    try {
      const result = await graphEndpoints.getLineageModules(repoId);
      // 转换数据格式
      const transformedModules = result.modules.map(transformModule);
      const transformedDeps = result.edges.map(transformEdge);
      setModules(transformedModules);
      setDependencies(transformedDeps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据失败");
      setModules([]);
      setDependencies([]);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []);

  // 监听仓库变化
  useEffect(() => {
    // 使用 graphId 调用 API（后端 API 参数名是 repo_id，但实际接受 graphId）
    const repoId = activeRepo?.graphId || activeRepo?.repoId;
    if (repoId) {
      loadData(repoId);
    } else {
      // 没有选中仓库时清空数据
      setModules([]);
      setDependencies([]);
      setSelectedModule(null);
    }
  }, [activeRepo?.graphId, activeRepo?.repoId, loadData]);

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
  const stats = useMemo(() => {
    if (!modules.length) return null;
    return {
      moduleCount: modules.length,
      serviceCount: modules.reduce((sum, m) => sum + m.subFunctions.length, 0),
      dependencyCount: dependencies.length,
    };
  }, [modules, dependencies]);

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

        {/* 仓库选择器 */}
        <RepoSelector showStats={false} width={220} />

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
                {stats.serviceCount}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  color: "#7888a8",
                }}
              >
                服务
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

        {/* 重置按钮 */}
        <Tooltip title="重置视图">
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            size="small"
            disabled={!activeRepo}
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
        {/* 未选择仓库提示 */}
        {!activeRepo && !loading && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
            }}
          >
            <InboxOutlined style={{ fontSize: 48, color: "#2a3a5a" }} />
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "#5a6a8a",
                letterSpacing: "0.04em",
              }}
            >
              请先选择仓库
            </div>
          </div>
        )}

        {/* 加载状态 */}
        {loading && activeRepo && (
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
        {error && !loading && activeRepo && (
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
            <Button onClick={() => activeRepo && loadData(activeRepo.graphId || activeRepo.repoId)} size="small">
              重试
            </Button>
          </div>
        )}

        {/* 空数据状态 */}
        {!loading && !error && activeRepo && modules.length === 0 && (
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
            <div style={{ fontSize: 40, opacity: 0.06 }}>◈</div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "#5a6a8a",
                letterSpacing: "0.04em",
              }}
            >
              该仓库暂无模块数据
            </div>
          </div>
        )}

        {/* 主视图 */}
        {activeRepo && modules.length > 0 && !loading && !error && (
          <>
            {/* 模块依赖图 */}
            <div style={{ flex: 1, position: "relative" }}>
              <ModuleGraph
                modules={modules}
                dependencies={dependencies}
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
