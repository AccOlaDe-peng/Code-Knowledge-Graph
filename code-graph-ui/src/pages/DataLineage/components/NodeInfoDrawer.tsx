/**
 * NodeInfoDrawer - 节点详情抽屉。
 *
 * 显示节点的完整信息，包括基础信息、AI 描述、代码片段等。
 */
import React from "react";
import { Drawer, Tag, Spin, Empty, Button } from "antd";
import {
  CodeOutlined,
  FileTextOutlined,
  ApiOutlined,
  LinkOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { NodeDetail, CodeSnippet } from "../../../store/lineageStore";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface NodeInfoDrawerProps {
  visible: boolean;
  node: NodeDetail | null;
  loading?: boolean;
  onClose: () => void;
  onNodeClick?: (nodeId: string) => void;
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const NodeInfoDrawer: React.FC<NodeInfoDrawerProps> = ({
  visible,
  node,
  loading,
  onClose,
  onNodeClick,
}) => {
  return (
    <Drawer
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CodeOutlined style={{ color: getTypeColor(node?.type), fontSize: 14 }} />
          <span
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontWeight: 600,
              color: "#8ab4c8",
            }}
          >
            {node?.name || "节点详情"}
          </span>
          {node?.type && (
            <Tag
              color={getTypeColor(node.type)}
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                margin: 0,
                border: "none",
              }}
            >
              {node.type}
            </Tag>
          )}
        </div>
      }
      placement="right"
      width={520}
      open={visible}
      onClose={onClose}
      styles={{
        header: {
          background: "#07090d",
          borderBottom: "1px solid #1a2535",
          padding: "14px 20px",
        },
        body: {
          background: "#07090d",
          padding: 20,
        },
      }}
      closeIcon={null}
    >
      {loading ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: 200,
          }}
        >
          <Spin size="large" />
          <div
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 10,
              color: "#4a6a7a",
              marginTop: 16,
            }}
          >
            加载节点信息...
          </div>
        </div>
      ) : node ? (
        <div>
          {/* 基础信息 */}
          <Section title="基础信息" icon={<FileTextOutlined />}>
            <InfoRow label="文件" value={node.file} mono />
            {node.signature && (
              <InfoRow label="签名" value={node.signature} mono />
            )}
            {node.line && (
              <InfoRow
                label="行号"
                value={
                  node.endLine
                    ? `${node.line} - ${node.endLine}`
                    : `${node.line}`
                }
              />
            )}
          </Section>

          {/* AI 功能描述 */}
          <Section title="AI 功能描述" icon={<CodeOutlined />}>
            {node.aiDescription ? (
              <div
                style={{
                  background: "rgba(0,212,255,0.04)",
                  border: "1px solid #00d4ff22",
                  borderRadius: 6,
                  padding: 12,
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 12,
                  color: "#b0c4d8",
                  lineHeight: 1.7,
                }}
              >
                {node.aiDescription}
              </div>
            ) : (
              <div
                style={{
                  background: "rgba(10,15,22,0.6)",
                  border: "1px solid #1a2535",
                  borderRadius: 6,
                  padding: 12,
                  textAlign: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono'",
                    fontSize: 11,
                    color: "#4a6a7a",
                    fontStyle: "italic",
                  }}
                >
                  暂无 AI 描述
                </span>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  style={{
                    display: "block",
                    margin: "10px auto 0",
                    background: "#080e16",
                    border: "1px solid #1a2535",
                    color: "#6b8aaa",
                    fontFamily: "'IBM Plex Mono'",
                    fontSize: 9,
                  }}
                >
                  重新生成
                </Button>
              </div>
            )}
          </Section>

          {/* 代码片段 */}
          {node.codeSnippet && (
            <Section title="代码片段" icon={<CodeOutlined />}>
              <CodeBlock snippet={node.codeSnippet} />
            </Section>
          )}

          {/* 关系统计 */}
          <Section title="调用关系" icon={<ApiOutlined />}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <StatBox
                label="调用其他节点"
                value={node.callCount}
                color="#00d4ff"
              />
              <StatBox
                label="被调用次数"
                value={node.calledByCount}
                color="#ffc145"
              />
            </div>

            {/* 依赖列表 */}
            {node.dependencies?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono'",
                    fontSize: 9,
                    color: "#4a6a7a",
                    marginBottom: 8,
                  }}
                >
                  依赖节点 ({node.dependencies.length})
                </div>
                <div
                  style={{
                    maxHeight: 120,
                    overflow: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {node.dependencies.slice(0, 10).map((depId, i) => (
                    <div
                      key={i}
                      onClick={() => onNodeClick?.(depId)}
                      style={{
                        fontFamily: "'IBM Plex Mono'",
                        fontSize: 10,
                        color: "#6b8aaa",
                        padding: "6px 8px",
                        background: "rgba(10,15,22,0.6)",
                        border: "1px solid #1a2535",
                        borderRadius: 4,
                        cursor: onNodeClick ? "pointer" : "default",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <LinkOutlined style={{ marginRight: 6, fontSize: 9 }} />
                      {depId.split(":").pop()}
                    </div>
                  ))}
                  {node.dependencies.length > 10 && (
                    <div
                      style={{
                        fontFamily: "'IBM Plex Mono'",
                        fontSize: 9,
                        color: "#4a6a7a",
                        textAlign: "center",
                        padding: 4,
                      }}
                    >
                      ... 还有 {node.dependencies.length - 10} 个依赖
                    </div>
                  )}
                </div>
              </div>
            )}
          </Section>

          {/* 元数据 */}
          {node.generatedAt && (
            <div
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: "1px solid #1a2535",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ClockCircleOutlined style={{ color: "#4a6a7a", fontSize: 11 }} />
              <span
                style={{
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 9,
                  color: "#4a6a7a",
                }}
              >
                生成于 {new Date(node.generatedAt).toLocaleString("zh-CN")}
              </span>
            </div>
          )}
        </div>
      ) : (
        <Empty
          description="暂无节点信息"
          style={{ marginTop: 60 }}
          imageStyle={{ height: 60 }}
        />
      )}
    </Drawer>
  );
};

// ─── 子组件：区块 ────────────────────────────────────────────────────────────

const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => {
  // 为图标添加样式
  const styledIcon = React.isValidElement(icon)
    ? React.cloneElement(icon as React.ReactElement<{ style?: React.CSSProperties }>, {
        style: { color: "#6b8aaa", fontSize: 12 },
      })
    : icon;

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        {styledIcon}
        <span
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 11,
            fontWeight: 600,
            color: "#6b8aaa",
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </span>
      </div>
      {children}
    </div>
  );
};

// ─── 子组件：信息行 ──────────────────────────────────────────────────────────

const InfoRow: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
}> = ({ label, value, mono }) => (
  <div
    style={{
      display: "flex",
      marginBottom: 8,
    }}
  >
    <span
      style={{
        fontFamily: "'IBM Plex Mono'",
        fontSize: 10,
        color: "#4a6a7a",
        width: 50,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
    <span
      style={{
        fontFamily: mono ? "'IBM Plex Mono'" : "inherit",
        fontSize: 11,
        color: "#8ab4c8",
        wordBreak: "break-all",
      }}
    >
      {value}
    </span>
  </div>
);

// ─── 子组件：统计盒子 ────────────────────────────────────────────────────────

const StatBox: React.FC<{
  label: string;
  value: number;
  color: string;
}> = ({ label, value, color }) => (
  <div
    style={{
      background: "rgba(10,15,22,0.8)",
      border: "1px solid #1a2535",
      borderRadius: 6,
      padding: 12,
      textAlign: "center",
    }}
  >
    <div
      style={{
        fontFamily: "'IBM Plex Mono'",
        fontSize: 20,
        fontWeight: 700,
        color,
      }}
    >
      {value}
    </div>
    <div
      style={{
        fontFamily: "'IBM Plex Mono'",
        fontSize: 9,
        color: "#4a6a7a",
        marginTop: 2,
      }}
    >
      {label}
    </div>
  </div>
);

// ─── 子组件：代码块 ──────────────────────────────────────────────────────────

const CodeBlock: React.FC<{ snippet: CodeSnippet }> = ({ snippet }) => {
  const lines = snippet.content.split("\n");

  return (
    <div
      style={{
        background: "#080e16",
        border: "1px solid #1a2535",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {/* 语言标签 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "6px 10px",
          background: "rgba(10,15,22,0.8)",
          borderBottom: "1px solid #1a2535",
        }}
      >
        <Tag
          style={{
            background: "rgba(176,142,255,0.1)",
            border: "none",
            color: "#b08eff",
            fontFamily: "'IBM Plex Mono'",
            fontSize: 9,
            margin: 0,
          }}
        >
          {snippet.language}
        </Tag>
        <Button
          size="small"
          icon={<CopyOutlined />}
          style={{
            background: "transparent",
            border: "none",
            color: "#4a6a7a",
            fontSize: 10,
          }}
          onClick={() => navigator.clipboard.writeText(snippet.content)}
        />
      </div>

      {/* 代码内容 */}
      <div
        style={{
          padding: "8px 0",
          maxHeight: 200,
          overflow: "auto",
          fontFamily: "'IBM Plex Mono'",
          fontSize: 11,
          lineHeight: 1.6,
        }}
      >
        {lines.map((line, i) => {
          const lineNum = snippet.startLine + i;
          const isHighlight = snippet.highlightLines.includes(lineNum);

          return (
            <div
              key={i}
              style={{
                display: "flex",
                background: isHighlight
                  ? "rgba(0,240,132,0.08)"
                  : "transparent",
              }}
            >
              <span
                style={{
                  width: 40,
                  paddingRight: 12,
                  textAlign: "right",
                  color: isHighlight ? "#00f084" : "#2a3a4a",
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                {lineNum}
              </span>
              <span
                style={{
                  color: isHighlight ? "#00f084" : "#8ab4c8",
                  whiteSpace: "pre",
                }}
              >
                {line}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

function getTypeColor(type?: string): string {
  const colors: Record<string, string> = {
    Controller: "#00d4ff",
    Service: "#00f084",
    Repository: "#ffc145",
    Function: "#b08eff",
    Class: "#b08eff",
    Component: "#00d4ff",
  };
  return colors[type || ""] || "#8ab4c8";
}

export default NodeInfoDrawer;
