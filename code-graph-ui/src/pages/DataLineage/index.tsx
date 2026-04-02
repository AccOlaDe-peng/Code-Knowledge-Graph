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
import { Spin, Button, Tooltip } from "antd";
import { ReloadOutlined, InboxOutlined } from "@ant-design/icons";
import RepoSelector from "../../components/ui/RepoSelector";
import { useRepoStore } from "../../store/repoStore";
import { getDataLineage } from "../../api/dataLineageApi";
import ModuleGraph from "./components/ModuleGraph";
import ModuleDetailPanel from "./components/ModuleDetailPanel";
import type { Module, ModuleDependency, DataLineageJSON } from "./types/dataLineage";

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
  const loadData = useCallback(async (repoName: string) => {
    // 防止并发重复请求
    if (loadingRef.current) return;
    loadingRef.current = true;

    setLoading(true);
    setError(null);
    setSelectedModule(null);

    try {
      // 从仓库名称提取前缀（按 - 或 _ 分割取第一部分，转小写）
      const namePrefix = repoName.split(/[-_]/)[0].toLowerCase();
      const result: DataLineageJSON = await getDataLineage(namePrefix);

      // 过滤掉引擎管理模块及其相关依赖
      const EXCLUDED_MODULE_IDS = ['engine'];
      const filteredModules = (result.modules || []).filter(
        (m) => !EXCLUDED_MODULE_IDS.includes(m.id)
      );
      const filteredDependencies = (result.moduleDependencies?.dependencies || []).filter(
        (dep) => !EXCLUDED_MODULE_IDS.includes(dep.from) && !EXCLUDED_MODULE_IDS.includes(dep.to)
      );

      setModules(filteredModules);
      setDependencies(filteredDependencies);
    } catch (err) {
      console.error('[DataLineage] Error:', err);
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
    const repoName = activeRepo?.repoName;
    if (repoName) {
      loadData(repoName);
    } else {
      // 没有选中仓库时清空数据
      setModules([]);
      setDependencies([]);
      setSelectedModule(null);
    }
  }, [activeRepo?.repoName, loadData]);

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
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "#07090d",
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
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
          height: 52,
        }}
      >
        {/* 标题 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: 2,
              background: "#ff66cc",
              boxShadow: "0 0 12px rgba(255,102,204,0.6)",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 15,
              fontWeight: 700,
              color: "#ff66cc",
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
                  color: "#ff66cc",
                }}
              >
                {stats.moduleCount}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  color: "#a8b8d8",
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
                  color: "#a8b8d8",
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
                  color: "#a8b8d8",
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
              color: "#a8b8d8",
            }}
          />
        </Tooltip>
      </div>

      {/* 主内容区 */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
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
                color: "#8898b8",
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
              flex: 1,
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
                color: "#a8b8d8",
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
            <Button onClick={() => activeRepo && loadData(activeRepo.repoName || '')} size="small">
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
                color: "#8898b8",
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
            <div style={{
              flex: 1,
              minHeight: 0,
            }}>
              <ModuleGraph
                modules={modules}
                dependencies={dependencies}
                selectedModuleId={selectedModule?.id}
                onModuleClick={handleModuleClick}
              />
            </div>
          </>
        )}

        {/* 模块详情面板（底部）- 始终显示 */}
        {activeRepo && modules.length > 0 && !loading && !error && (
          <ModuleDetailPanel
            module={selectedModule}
            collapsed={panelCollapsed}
            onCollapseChange={setPanelCollapsed}
          />
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
