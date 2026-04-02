/**
 * FunctionDrawer - 函数详情抽屉
 *
 * 显示函数签名、参数、返回值、Callers/Callees 列表
 */
import React from "react";
import { Drawer, Tag } from "antd";
import {
  FunctionOutlined,
  FileTextOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";
import { useFunctionCallStore } from "../../../../store/functionCallStore";
import { FUNCTION_TYPE_COLORS } from "../../types";

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const FunctionDrawer: React.FC = () => {
  const {
    selectedFunctionId,
    drawerFunctionId,
    setSelectedFunction,
    setDrawerFunction,
    getFunctionById,
    getModuleByFunctionId,
    getCallers,
    getCallees,
  } = useFunctionCallStore();

  const funcId = drawerFunctionId ?? selectedFunctionId;
  const func = funcId ? getFunctionById(funcId) : null;
  const module = funcId ? getModuleByFunctionId(funcId) : null;
  const callers = funcId ? getCallers(funcId) : [];
  const callees = funcId ? getCallees(funcId) : [];

  const colors = func
    ? FUNCTION_TYPE_COLORS[func.type] || FUNCTION_TYPE_COLORS.service
    : null;

  const handleClose = () => {
    setDrawerFunction(null);
  };

  return (
    <Drawer
      title={
        func ? (
          <div style={styles.title}>
            <FunctionOutlined
              style={{ color: colors?.text || "#00d4ff", marginRight: 8 }}
            />
            <span style={{ color: "#a8b8d8" }}>{func.name}</span>
          </div>
        ) : (
          "函数详情"
        )
      }
      placement="right"
      width={400}
      open={!!drawerFunctionId}
      onClose={handleClose}
      styles={{
        body: { background: "#0a0d14", padding: "16px 20px" },
        header: {
          background: "#0a0d14",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        },
      }}
    >
      {func && (
        <div style={styles.container}>
          {/* 类型标签 */}
          <div style={styles.tagRow}>
            <Tag
              style={{
                background: `${colors?.border}15`,
                border: `1px solid ${colors?.border}40`,
                color: colors?.text,
                borderRadius: 4,
                padding: "4px 12px",
              }}
            >
              {func.type.toUpperCase()}
            </Tag>
            <Tag
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: func.visibility === "public" ? "#00f084" : "#ffc145",
                borderRadius: 4,
                padding: "4px 12px",
              }}
            >
              {func.visibility}
            </Tag>
            {func.static && (
              <Tag
                style={{
                  background: "rgba(176,142,255,0.1)",
                  border: "1px solid rgba(176,142,255,0.3)",
                  color: "#b08eff",
                  borderRadius: 4,
                  padding: "4px 12px",
                }}
              >
                STATIC
              </Tag>
            )}
          </div>

          {/* 所属模块 */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>所属模块</div>
            <div style={styles.moduleTag}>
              <span style={styles.moduleName}>{module?.name}</span>
              <span style={styles.moduleDesc}>{module?.displayName}</span>
            </div>
          </div>

          {/* 签名 */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>签名</div>
            <div style={styles.signature}>
              <span style={{ color: "#b08eff" }}>{func.returnType.type}</span>
              <span style={{ color: "#00d4ff" }}> {func.name}</span>
              <span style={{ color: "#7888a8" }}>(</span>
              {func.params.map((p, i) => (
                <span key={i}>
                  <span style={{ color: "#ffc145" }}>{p.type}</span>
                  <span style={{ color: "#7888a8" }}> {p.name}</span>
                  {i < func.params.length - 1 && (
                    <span style={{ color: "#7888a8" }}>, </span>
                  )}
                </span>
              ))}
              <span style={{ color: "#7888a8" }}>)</span>
            </div>
          </div>

          {/* 参数列表 */}
          {func.params.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionLabel}>参数</div>
              <div style={styles.paramList}>
                {func.params.map((p, i) => (
                  <div key={i} style={styles.paramItem}>
                    <span style={styles.paramType}>{p.type}</span>
                    <span style={styles.paramName}>{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 位置 */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>位置</div>
            <div style={styles.location}>
              <FileTextOutlined style={{ marginRight: 8, color: "#5a6a8a" }} />
              <span style={styles.locationFile}>{func.sourceFile}</span>
              <span style={styles.locationLine}>:{func.sourceLine}</span>
            </div>
          </div>

          {/* 统计 */}
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <div style={styles.statValue}>{func.callerCount}</div>
              <div style={styles.statLabel}>被调用</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statValue}>{func.calleeCount}</div>
              <div style={styles.statLabel}>调出</div>
            </div>
          </div>

          {/* Callers */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>被调用 ({callers.length})</div>
            {callers.length > 0 ? (
              <div style={styles.callList}>
                {callers.slice(0, 10).map((c, i) => (
                  <div
                    key={i}
                    style={styles.callItem}
                    onClick={() => {
                      setSelectedFunction(c.sourceFunctionId);
                      setDrawerFunction(c.sourceFunctionId);
                    }}
                  >
                    <ArrowRightOutlined
                      style={{ color: "#00f084", marginRight: 8, fontSize: 10 }}
                    />
                    <span style={styles.callName}>
                      {c.sourceFunctionName.split(".").pop()}
                    </span>
                    <span style={styles.callModule}>{c.sourceModule}</span>
                  </div>
                ))}
                {callers.length > 10 && (
                  <div style={styles.moreHint}>
                    还有 {callers.length - 10} 个...
                  </div>
                )}
              </div>
            ) : (
              <div style={styles.emptyList}>无调用者</div>
            )}
          </div>

          {/* Callees */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>调用目标 ({callees.length})</div>
            {callees.length > 0 ? (
              <div style={styles.callList}>
                {callees.slice(0, 10).map((c, i) => (
                  <div
                    key={i}
                    style={styles.callItem}
                    onClick={() => {
                      setSelectedFunction(c.targetFunctionId);
                      setDrawerFunction(c.targetFunctionId);
                    }}
                  >
                    <ArrowRightOutlined
                      style={{ color: "#ffc145", marginRight: 8, fontSize: 10 }}
                    />
                    <span style={styles.callName}>
                      {c.targetFunctionName.split(".").pop()}
                    </span>
                    <span style={styles.callModule}>{c.targetModule}</span>
                  </div>
                ))}
                {callees.length > 10 && (
                  <div style={styles.moreHint}>
                    还有 {callees.length - 10} 个...
                  </div>
                )}
              </div>
            ) : (
              <div style={styles.emptyList}>无调用目标</div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
};

// ─── 样式 ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  title: {
    display: "flex",
    alignItems: "center",
  },
  tagRow: {
    display: "flex",
    gap: 8,
    marginBottom: 4,
  },
  section: {
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 10,
    color: "#5a6a8a",
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.05em",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  moduleTag: {
    background: "rgba(0,212,255,0.08)",
    border: "1px solid rgba(0,212,255,0.2)",
    borderRadius: 4,
    padding: "8px 12px",
  },
  moduleName: {
    fontSize: 12,
    color: "#00d4ff",
    fontFamily: "var(--font-mono)",
    display: "block",
    marginBottom: 2,
  },
  moduleDesc: {
    fontSize: 11,
    color: "#7888a8",
  },
  signature: {
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 4,
    padding: "12px 16px",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    lineHeight: 1.6,
    overflow: "auto",
  },
  paramList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  paramItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    background: "rgba(0,0,0,0.2)",
    borderRadius: 4,
  },
  paramType: {
    fontSize: 11,
    color: "#ffc145",
    fontFamily: "var(--font-mono)",
  },
  paramName: {
    fontSize: 11,
    color: "#a8b8d8",
    fontFamily: "var(--font-mono)",
  },
  location: {
    display: "flex",
    alignItems: "center",
    padding: "8px 10px",
    background: "rgba(0,0,0,0.2)",
    borderRadius: 4,
  },
  locationFile: {
    fontSize: 11,
    color: "#a8b8d8",
    fontFamily: "var(--font-mono)",
  },
  locationLine: {
    fontSize: 11,
    color: "#ffc145",
    fontFamily: "var(--font-mono)",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  statCard: {
    background: "rgba(0,212,255,0.06)",
    border: "1px solid rgba(0,212,255,0.15)",
    borderRadius: 6,
    padding: 12,
    textAlign: "center",
  },
  statValue: {
    fontSize: 22,
    fontWeight: 700,
    color: "#00d4ff",
    fontFamily: "var(--font-mono)",
  },
  statLabel: {
    fontSize: 10,
    color: "#7888a8",
    marginTop: 4,
  },
  callList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  callItem: {
    display: "flex",
    alignItems: "center",
    padding: "8px 10px",
    background: "rgba(255,255,255,0.02)",
    borderRadius: 4,
    border: "1px solid rgba(255,255,255,0.04)",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  callName: {
    fontSize: 11,
    color: "#a8b8d8",
    fontFamily: "var(--font-mono)",
    flex: 1,
  },
  callModule: {
    fontSize: 10,
    color: "#5a6a8a",
  },
  emptyList: {
    fontSize: 11,
    color: "#5a6a8a",
    textAlign: "center",
    padding: "12px",
  },
  moreHint: {
    fontSize: 10,
    color: "#5a6a8a",
    textAlign: "center",
    padding: "8px",
  },
};

export default FunctionDrawer;
