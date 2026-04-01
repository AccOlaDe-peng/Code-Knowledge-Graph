/**
 * FunctionCallGraph - 函数调用图页面
 *
 * 三层视图架构：
 * - 模块总览：展示模块间调用关系
 * - 模块详情：左侧模块树 + 右侧函数调用图
 * - 函数详情：右侧抽屉显示函数信息
 */
import React, { useEffect } from "react";
import { Spin, Button, Empty } from "antd";
import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import RepoSelector from "../../components/ui/RepoSelector";
import { useRepoStore } from "../../store/repoStore";
import { useFunctionCallStore } from "../../store/functionCallStore";
import ModuleOverview from "./components/ModuleOverview";
import ModuleDetail from "./components/ModuleDetail";
import FunctionDrawer from "./components/FunctionDrawer";
import GlobalSearch from "./components/GlobalSearch";
import PathTrace from "./components/PathTrace";

// ─── 主页面组件 ──────────────────────────────────────────────────────────────

const FunctionCallGraph: React.FC = () => {
  const { activeRepo } = useRepoStore();
  const {
    data,
    loading,
    error,
    currentView,
    loadData,
    clearData,
    setCurrentView,
    setSelectedModule,
  } = useFunctionCallStore();

  // 加载数据
  useEffect(() => {
    if (activeRepo?.repoId) {
      loadData(activeRepo.repoId);
    } else {
      clearData();
    }
  }, [activeRepo?.repoId, loadData, clearData]);

  // 返回模块总览
  const handleBackToOverview = () => {
    setCurrentView("overview");
    setSelectedModule(null);
  };

  return (
    <div style={styles.container}>
      {/* 工具栏 - 始终显示 */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          {/* 返回按钮 */}
          {currentView === "detail" && (
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={handleBackToOverview}
              style={{ color: "#00d4ff", marginRight: 12 }}
            >
              返回总览
            </Button>
          )}

          {/* 标题 */}
          <div style={styles.title}>
            <div style={styles.titleDot} />
            <span style={styles.titleText}>
              {currentView === "overview"
                ? "函数调用图"
                : data
                  ? `${data.project_name} / 模块详情`
                  : "函数调用图"}
            </span>
          </div>
        </div>

        <div style={styles.toolbarCenter}>
          <RepoSelector showStats={false} width={200} />
        </div>

        <div style={styles.toolbarRight}>
          {/* 全局搜索 */}
          {data && <GlobalSearch />}

          {/* 统计信息 */}
          {currentView === "overview" && data && (
            <div style={styles.stats}>
              <StatChip label="模块" value={data.total_modules} color="#00d4ff" />
              <StatChip label="函数" value={data.total_functions.toLocaleString()} color="#00f084" />
              <StatChip label="调用" value={data.total_call_chains.toLocaleString()} color="#ffc145" />
            </div>
          )}

          {/* 路径追踪 */}
          {data && <PathTrace />}
        </div>
      </div>

      {/* 主内容区 */}
      <div style={styles.content}>
        {/* 未选择仓库 */}
        {!activeRepo && (
          <div style={styles.empty}>
            <Empty
              description={
                <span style={{ color: "#5a6a8a" }}>请先选择仓库以查看函数调用图</span>
              }
            />
          </div>
        )}

        {/* 加载中 */}
        {activeRepo && loading && (
          <div style={styles.loading}>
            <Spin size="large" />
            <span style={{ color: "#7888a8", marginTop: 16 }}>加载函数调用图数据...</span>
          </div>
        )}

        {/* 加载错误 */}
        {activeRepo && error && !loading && (
          <div style={styles.error}>
            <span style={{ color: "#ff6b6b" }}>{error}</span>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => loadData(activeRepo.repoId)}
              style={{ marginTop: 16 }}
            >
              重试
            </Button>
          </div>
        )}

        {/* 无数据 */}
        {activeRepo && !loading && !error && !data && (
          <div style={styles.empty}>
            <Empty
              description={
                <span style={{ color: "#5a6a8a" }}>暂无函数调用图数据，请先分析仓库</span>
              }
            />
          </div>
        )}

        {/* 有数据时显示视图 */}
        {data && !loading && (
          <>
            {currentView === "overview" ? (
              <ModuleOverview />
            ) : (
              <ModuleDetail />
            )}
          </>
        )}
      </div>

      {/* 函数详情抽屉 */}
      <FunctionDrawer />
    </div>
  );
};

// ─── 辅助组件 ────────────────────────────────────────────────────────────────

const StatChip: React.FC<{ label: string; value: string | number; color?: string }> = ({
  label,
  value,
  color = "#00d4ff",
}) => (
  <div style={{ ...styles.statChip, borderColor: `${color}40` }}>
    <span style={{ ...styles.statLabel, color }}>{value}</span>
    <span style={styles.statValue}>{label}</span>
  </div>
);

// ─── 样式 ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "#07090d",
    display: "flex",
    flexDirection: "column",
    zIndex: 1,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 20px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    background: "rgba(6,8,12,0.97)",
    backdropFilter: "blur(12px)",
    height: 48,
    flexShrink: 0,
  },
  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  toolbarCenter: {
    display: "flex",
    alignItems: "center",
  },
  toolbarRight: {
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  titleDot: {
    width: 9,
    height: 9,
    borderRadius: 2,
    background: "#00d4ff",
    boxShadow: "0 0 12px rgba(0,212,255,0.6)",
  },
  titleText: {
    fontFamily: "var(--font-ui)",
    fontSize: 15,
    fontWeight: 700,
    color: "#00d4ff",
    letterSpacing: "0.04em",
  },
  stats: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  statChip: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    padding: "4px 12px",
    borderRadius: 4,
    border: "1px solid",
    background: "rgba(0,0,0,0.3)",
  },
  statLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: 14,
    fontWeight: 600,
  },
  statValue: {
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    color: "#7888a8",
  },
  content: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  loading: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  error: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
};

export default FunctionCallGraph;
