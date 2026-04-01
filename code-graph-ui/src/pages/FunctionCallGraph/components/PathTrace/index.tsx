/**
 * PathTrace - 路径追踪面板
 *
 * 设置起点/终点，查找调用路径
 */
import React from "react";
import { Button, Empty, Tag } from "antd";
import {
  SearchOutlined,
  CloseOutlined,
  ArrowRightOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { useRepoStore } from "../../../../store/repoStore";
import { useFunctionCallStore } from "../../../../store/functionCallStore";

const PathTrace: React.FC = () => {
  const { activeRepo } = useRepoStore();
  const {
    pathFrom,
    pathTo,
    tracedPaths,
    selectedPathIndex,
    tracingPath,
    getFunctionById,
    setPathFrom,
    setPathTo,
    tracePath,
    setSelectedPathIndex,
    clearPathTrace,
  } = useFunctionCallStore();

  const fromFunc = pathFrom ? getFunctionById(pathFrom) : null;
  const toFunc = pathTo ? getFunctionById(pathTo) : null;

  const handleTrace = () => {
    if (activeRepo?.repoId && pathFrom && pathTo) {
      tracePath(activeRepo.repoId);
    }
  };

  const handleClear = () => {
    clearPathTrace();
  };

  // 无起点/终点时不显示
  if (!pathFrom && !pathTo) {
    return null;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>路径追踪</span>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={handleClear}
          style={{ color: "#5a6a8a" }}
        />
      </div>

      <div style={styles.inputs}>
        <div style={styles.inputRow}>
          <span style={styles.label}>起点:</span>
          {fromFunc ? (
            <div style={styles.funcTag}>
              <span style={styles.funcName}>{fromFunc.name}</span>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined style={{ fontSize: 10 }} />}
                onClick={() => setPathFrom(null)}
                style={{ color: "#5a6a8a", padding: "0 4px" }}
              />
            </div>
          ) : (
            <span style={styles.placeholder}>点击函数设为起点</span>
          )}
        </div>

        <div style={styles.inputRow}>
          <span style={styles.label}>终点:</span>
          {toFunc ? (
            <div style={styles.funcTag}>
              <span style={styles.funcName}>{toFunc.name}</span>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined style={{ fontSize: 10 }} />}
                onClick={() => setPathTo(null)}
                style={{ color: "#5a6a8a", padding: "0 4px" }}
              />
            </div>
          ) : (
            <span style={styles.placeholder}>点击函数设为终点</span>
          )}
        </div>
      </div>

      <div style={styles.actions}>
        <Button
          type="primary"
          size="small"
          icon={tracingPath ? <LoadingOutlined /> : <SearchOutlined />}
          onClick={handleTrace}
          disabled={!pathFrom || !pathTo || tracingPath}
        >
          查找路径
        </Button>
      </div>

      {/* 搜索结果 */}
      {tracedPaths && (
        <div style={styles.results}>
          {tracedPaths.length === 0 ? (
            <Empty
              description={<span style={{ color: "#5a6a8a", fontSize: 12 }}>未找到路径</span>}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <>
              <div style={styles.resultCount}>找到 {tracedPaths.length} 条路径</div>
              {tracedPaths.map((path, index) => (
                <div
                  key={index}
                  onClick={() => setSelectedPathIndex(index)}
                  style={{
                    ...styles.pathItem,
                    background: selectedPathIndex === index ? "rgba(0,212,255,0.1)" : "transparent",
                    borderLeft: selectedPathIndex === index ? "2px solid #00d4ff" : "2px solid transparent",
                  }}
                >
                  <div style={styles.pathHeader}>
                    <span style={styles.pathIndex}>路径 {index + 1}</span>
                    <Tag style={styles.pathLength}>{path.length} 跳</Tag>
                  </div>
                  <div style={styles.pathNodes}>
                    {path.nodes.slice(0, 4).map((node, i) => (
                      <span key={node.id}>
                        <span style={styles.pathNodeName}>{node.name}</span>
                        {i < Math.min(path.nodes.length, 4) - 1 && (
                          <ArrowRightOutlined style={styles.pathArrow} />
                        )}
                      </span>
                    ))}
                    {path.nodes.length > 4 && (
                      <span style={styles.pathMore}>... +{path.nodes.length - 4}</span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "rgba(10,13,20,0.9)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "10px 14px",
    minWidth: 200,
    maxWidth: 280,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: {
    fontSize: 11,
    color: "#7888a8",
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.05em",
  },
  inputs: {
    marginBottom: 10,
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  label: {
    fontSize: 10,
    color: "#5a6a8a",
    width: 32,
  },
  funcTag: {
    display: "flex",
    alignItems: "center",
    background: "rgba(0,212,255,0.1)",
    border: "1px solid rgba(0,212,255,0.2)",
    borderRadius: 4,
    padding: "2px 8px",
    flex: 1,
  },
  funcName: {
    fontSize: 11,
    color: "#00d4ff",
    fontFamily: "var(--font-mono)",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  placeholder: {
    fontSize: 10,
    color: "#5a6a8a",
    fontStyle: "italic",
  },
  actions: {
    display: "flex",
    justifyContent: "center",
  },
  results: {
    marginTop: 10,
    borderTop: "1px solid rgba(255,255,255,0.06)",
    paddingTop: 10,
    maxHeight: 200,
    overflow: "auto",
  },
  resultCount: {
    fontSize: 10,
    color: "#7888a8",
    marginBottom: 8,
  },
  pathItem: {
    padding: "8px 10px",
    borderRadius: 4,
    cursor: "pointer",
    marginBottom: 4,
    transition: "all 0.15s ease",
  },
  pathHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  pathIndex: {
    fontSize: 11,
    color: "#a8b8d8",
  },
  pathLength: {
    background: "rgba(0,240,132,0.1)",
    border: "none",
    color: "#00f084",
    fontSize: 9,
    padding: "0 6px",
  },
  pathNodes: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
  },
  pathNodeName: {
    fontSize: 10,
    color: "#7888a8",
    fontFamily: "var(--font-mono)",
  },
  pathArrow: {
    fontSize: 8,
    color: "#5a6a8a",
    margin: "0 2px",
  },
  pathMore: {
    fontSize: 10,
    color: "#5a6a8a",
  },
};

export default PathTrace;
