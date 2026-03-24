/**
 * CrossModulePanel - 跨模块依赖面板。
 *
 * 显示当前模块的跨模块调用列表，区分入向依赖和出向依赖。
 */
import React from "react";
import { Drawer, Tag, Empty, Divider } from "antd";
import {
  ArrowRightOutlined,
  ArrowLeftOutlined,
  ExportOutlined,
  ImportOutlined,
} from "@ant-design/icons";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface CrossModuleCall {
  from: string;
  to: string;
  fromModule: string;
  toModule: string;
}

interface CrossModulePanelProps {
  visible: boolean;
  calls: CrossModuleCall[];
  currentModule: string;
  onClose: () => void;
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const CrossModulePanel: React.FC<CrossModulePanelProps> = ({
  visible,
  calls,
  currentModule,
  onClose,
}) => {
  // 分类：出向依赖（调用其他模块）和入向依赖（被其他模块调用）
  const outgoingCalls = calls.filter((c) => c.fromModule === currentModule);
  const incomingCalls = calls.filter((c) => c.toModule === currentModule);

  // 统计目标模块
  const outgoingByModule = groupBy(outgoingCalls, "toModule");
  const incomingByModule = groupBy(incomingCalls, "fromModule");

  return (
    <Drawer
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ExportOutlined style={{ color: "#ff6b6b" }} />
          <span>跨模块依赖</span>
          <Tag color="#ff6b6b" style={{ marginLeft: 8 }}>
            {calls.length}
          </Tag>
        </div>
      }
      placement="right"
      width={380}
      onClose={onClose}
      open={visible}
      styles={{
        header: { background: "#0d1520", borderBottom: "1px solid #1a2535" },
        body: { background: "#07090d", padding: 16 },
      }}
    >
      {/* 出向依赖 */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 10,
          }}
        >
          <ArrowRightOutlined style={{ color: "#ff6b6b", fontSize: 12 }} />
          <span
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 10,
              color: "#ff6b6b",
              letterSpacing: "0.1em",
            }}
          >
            出向依赖（调用其他模块）
          </span>
          <Tag color="#ff6b6b" style={{ marginLeft: "auto" }}>
            {outgoingCalls.length}
          </Tag>
        </div>

        {Object.keys(outgoingByModule).length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span style={{ color: "#3a5a6a", fontSize: 10 }}>无出向依赖</span>
            }
          />
        ) : (
          Object.entries(outgoingByModule).map(([targetModule, moduleCalls]) => (
            <div
              key={targetModule}
              style={{
                background: "rgba(10,15,22,0.6)",
                border: "1px solid #1a2535",
                borderRadius: 6,
                padding: 10,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: "'Syne'",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#b08eff",
                  }}
                >
                  {targetModule}
                </span>
                <Tag style={{ fontSize: 9 }}>{moduleCalls.length} 调用</Tag>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {moduleCalls.slice(0, 5).map((call, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontFamily: "'IBM Plex Mono'",
                      fontSize: 9,
                      color: "#6b8aaa",
                    }}
                  >
                    <span style={{ color: "#00f084" }}>{call.from}</span>
                    <ArrowRightOutlined style={{ fontSize: 8, color: "#3a5a6a" }} />
                    <span style={{ color: "#ffc145" }}>{call.to}</span>
                  </div>
                ))}
                {moduleCalls.length > 5 && (
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono'",
                      fontSize: 8,
                      color: "#3a5a6a",
                      textAlign: "center",
                    }}
                  >
                    +{moduleCalls.length - 5} more
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <Divider style={{ margin: "16px 0", borderColor: "#1a2535" }} />

      {/* 入向依赖 */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 10,
          }}
        >
          <ArrowLeftOutlined style={{ color: "#00d4ff", fontSize: 12 }} />
          <span
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 10,
              color: "#00d4ff",
              letterSpacing: "0.1em",
            }}
          >
            入向依赖（被其他模块调用）
          </span>
          <Tag color="#00d4ff" style={{ marginLeft: "auto" }}>
            {incomingCalls.length}
          </Tag>
        </div>

        {Object.keys(incomingByModule).length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span style={{ color: "#3a5a6a", fontSize: 10 }}>无入向依赖</span>
            }
          />
        ) : (
          Object.entries(incomingByModule).map(([sourceModule, moduleCalls]) => (
            <div
              key={sourceModule}
              style={{
                background: "rgba(10,15,22,0.6)",
                border: "1px solid #1a2535",
                borderRadius: 6,
                padding: 10,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: "'Syne'",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#00d4ff",
                  }}
                >
                  {sourceModule}
                </span>
                <Tag style={{ fontSize: 9 }}>{moduleCalls.length} 调用</Tag>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {moduleCalls.slice(0, 5).map((call, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontFamily: "'IBM Plex Mono'",
                      fontSize: 9,
                      color: "#6b8aaa",
                    }}
                  >
                    <span style={{ color: "#ffc145" }}>{call.from}</span>
                    <ArrowRightOutlined style={{ fontSize: 8, color: "#3a5a6a" }} />
                    <span style={{ color: "#00f084" }}>{call.to}</span>
                  </div>
                ))}
                {moduleCalls.length > 5 && (
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono'",
                      fontSize: 8,
                      color: "#3a5a6a",
                      textAlign: "center",
                    }}
                  >
                    +{moduleCalls.length - 5} more
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 提示 */}
      <div
        style={{
          marginTop: 16,
          padding: "8px 12px",
          background: "rgba(176,142,255,0.05)",
          border: "1px solid #b08eff22",
          borderRadius: 4,
        }}
      >
        <span
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 9,
            color: "#6b8aaa",
          }}
        >
          💡 点击其他模块的节点可跳转查看详情
        </span>
      </div>
    </Drawer>
  );
};

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce(
    (acc, item) => {
      const k = String(item[key]);
      if (!acc[k]) acc[k] = [];
      acc[k].push(item);
      return acc;
    },
    {} as Record<string, T[]>
  );
}

export default CrossModulePanel;
