import React, { useEffect } from "react";
import { Select, Spin } from "antd";
import { useRepoStore } from "../../../store/repoStore";
import { useGraphStore } from "../../../store/graphStore";
import { graphApi } from "../../../api/graphApi";

type RepoSelectorProps = {
  /** 是否显示统计信息（节点数、边数、SHA） */
  showStats?: boolean;
  /** 自定义样式 */
  style?: React.CSSProperties;
  /** 选择器宽度 */
  width?: number | string;
};

const RepoSelector: React.FC<RepoSelectorProps> = ({
  showStats = true,
  style,
  width = 260,
}) => {
  const { repos, activeRepo, loading, setRepos, setActiveRepo, setLoading, setError } =
    useRepoStore();
  const { setActiveGraphId } = useGraphStore();

  // 加载仓库列表
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await graphApi.listGraphs();
        setRepos(res.graphs || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载仓库列表失败");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [setRepos, setLoading, setError]);

  const handleChange = (graphId: string) => {
    const repo = repos.find((r) => r.graphId === graphId) ?? null;
    setActiveRepo(repo);
    setActiveGraphId(graphId);
  };

  // 统计信息 Chip
  const Chip: React.FC<{ label: string; value: string | number; color?: string }> = ({
    label,
    value,
    color = "#00d4ff",
  }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 3,
        background: `rgba(${color === "#00d4ff" ? "0,212,255" : color === "#00f084" ? "0,240,132" : "255,193,69"},0.08)`,
        border: `1px solid rgba(${color === "#00d4ff" ? "0,212,255" : color === "#00f084" ? "0,240,132" : "255,193,69"},0.2)`,
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: "var(--t-muted)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          color,
          fontFamily: "var(--font-mono)",
          fontWeight: 500,
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, ...style }}>
      {/* 仓库选择器 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            color: "var(--t-muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.1em",
            whiteSpace: "nowrap",
          }}
        >
          仓库
        </span>
        {loading ? (
          <Spin size="small" />
        ) : (
          <Select
            placeholder="— 选择仓库 —"
            style={{ width }}
            value={activeRepo?.graphId ?? undefined}
            onChange={handleChange}
            variant="borderless"
            popupMatchSelectWidth={false}
            options={repos.filter((r) => r.graphId && r.status !== 'analyzing').map((r) => ({
              value: r.graphId,
              label: (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    color: "var(--t-primary)",
                  }}
                >
                  {r.repoName}
                  <span
                    style={{
                      color: "var(--t-muted)",
                      marginLeft: 8,
                      fontSize: 11,
                    }}
                  >
                    /{r.graphId?.slice(0, 8) ?? "????"}
                  </span>
                </span>
              ),
            }))}
            notFoundContent={
              <span
                style={{
                  color: "var(--t-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
              >
                暂无仓库 — 请前往 /repository 添加
              </span>
            }
            styles={{ popup: { root: { minWidth: 320 } } }}
          />
        )}
      </div>

      {/* 统计信息 */}
      {showStats && activeRepo && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Chip label="节点" value={activeRepo.nodeCount.toLocaleString()} color="#00d4ff" />
          <Chip label="边" value={activeRepo.edgeCount.toLocaleString()} color="#00f084" />
          {activeRepo.gitCommit && (
            <Chip label="SHA" value={activeRepo.gitCommit.slice(0, 7)} color="#ffc145" />
          )}
        </div>
      )}

      {/* 未选择提示 */}
      {showStats && !activeRepo && !loading && (
        <span
          style={{
            fontSize: 11,
            color: "var(--t-muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em",
          }}
        >
          未选择仓库
        </span>
      )}
    </div>
  );
};

export default RepoSelector;
