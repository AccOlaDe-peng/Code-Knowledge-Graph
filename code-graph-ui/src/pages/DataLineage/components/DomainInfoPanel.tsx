/**
 * DomainInfoPanel - 右侧固定信息面板。
 *
 * 显示选中领域或节点的简要信息，点击「查看详情」打开抽屉。
 */
import React, { useState } from "react";
import { Button, Spin, Tag, Collapse } from "antd";
import {
  AppstoreOutlined,
  CodeOutlined,
  FileTextOutlined,
  RightOutlined,
  InfoCircleOutlined,
  DownOutlined,
} from "@ant-design/icons";
import type {
  DomainDescription,
  NodeDetail,
  DomainInfo,
} from "../../../store/lineageStore";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface DomainInfoPanelProps {
  type: "domain" | "node" | null;
  data: DomainDescription | NodeDetail | null;
  domainInfo?: DomainInfo; // 领域统计信息（用于简要显示）
  loading?: boolean;
  onViewDetail?: () => void;
}

// ─── 子组件：领域面板 ────────────────────────────────────────────────────────

const DomainPanel: React.FC<{
  data: DomainDescription;
  domainInfo?: DomainInfo;
  onViewDetail?: () => void;
}> = ({ data, domainInfo, onViewDetail }) => (
  <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
    {/* 领域名称 */}
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: domainInfo?.color || "#00f084",
          boxShadow: `0 0 8px ${domainInfo?.color || "#00f084"}66`,
        }}
      />
      <span
        style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: 13,
          fontWeight: 600,
          color: domainInfo?.color || "#00f084",
        }}
      >
        {domainInfo?.name || data.domainId}
      </span>
    </div>

    {/* 统计信息 */}
    {domainInfo && (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <StatItem label="节点" value={domainInfo.nodeCount} color="#b08eff" />
        <StatItem label="服务" value={domainInfo.serviceCount} color="#00f084" />
        <StatItem label="控制器" value={domainInfo.controllerCount} color="#00d4ff" />
        <StatItem label="Repository" value={domainInfo.repositoryCount} color="#ffc145" />
      </div>
    )}

    {/* AI 摘要预览 */}
    {data.summary && (
      <div
        style={{
          background: "rgba(0,240,132,0.04)",
          border: "1px solid #00f08422",
          borderRadius: 4,
          padding: 10,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 9,
            color: "#4a6a5a",
            marginBottom: 4,
            letterSpacing: "0.05em",
          }}
        >
          AI 摘要
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 11,
            color: "#8ab4c8",
            lineHeight: 1.6,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {data.summary}
        </div>
      </div>
    )}

    {/* 查看详情按钮（仅在提供回调时显示） */}
    {onViewDetail && (
      <div style={{ marginTop: "auto", paddingTop: 12 }}>
        <Button
          type="primary"
          block
          onClick={onViewDetail}
          icon={<RightOutlined />}
          iconPosition="end"
          style={{
            background: "rgba(0,240,132,0.1)",
            border: "1px solid #00f08444",
            color: "#00f084",
            fontFamily: "'IBM Plex Mono'",
            fontSize: 11,
            height: 36,
          }}
        >
          查看详情
        </Button>
      </div>
    )}
  </div>
);

// ─── 子组件：节点面板 ────────────────────────────────────────────────────────

const NodePanel: React.FC<{
  data: NodeDetail;
}> = ({ data }) => {
  const [activeKeys, setActiveKeys] = useState<string[]>(["description"]);

  // 生成静态功能说明（当没有 AI 描述时）
  const generateStaticDescription = (): string => {
    const parts: string[] = [];

    // 根据节点类型生成描述
    if (data.type === "Function" || data.type === "function") {
      parts.push(`这是一个方法节点，名称为 ${data.name}。`);

      if (data.signature) {
        parts.push(`方法签名: ${data.signature}`);
      }

      if (data.annotations && data.annotations.length > 0) {
        const annStr = data.annotations.join(", ");
        parts.push(`标注了 ${annStr} 注解。`);
      }
    } else if (data.type === "Service" || data.type === "service") {
      parts.push(`这是一个服务类节点，名称为 ${data.name}。`);
    } else if (data.type === "Controller" || data.type === "controller") {
      parts.push(`这是一个控制器节点，名称为 ${data.name}，负责处理 HTTP 请求。`);
    } else if (data.type === "Repository" || data.type === "repository") {
      parts.push(`这是一个数据访问层节点，名称为 ${data.name}，负责数据库操作。`);
    } else {
      parts.push(`这是一个 ${data.type} 类型的节点，名称为 ${data.name}。`);
    }

    return parts.join(" ");
  };

  // 生成总结
  const generateSummary = (): string => {
    const parts: string[] = [];

    // 关键指标
    parts.push(`📊 调用 ${data.callCount} 次，被调用 ${data.calledByCount} 次。`);

    // 影响范围
    if (data.callCount > 10) {
      parts.push("该节点是高频调用节点，影响范围较广。");
    } else if (data.callCount > 5) {
      parts.push("该节点调用频率中等。");
    } else {
      parts.push("该节点调用频率较低。");
    }

    // 依赖情况
    if (data.dependencies && data.dependencies.length > 0) {
      parts.push(`依赖 ${data.dependencies.length} 个其他节点。`);
    }

    return parts.join(" ");
  };

  // 使用 AI 描述或静态描述
  const description = data.aiDescription || data.functionDescription || generateStaticDescription();
  const summary = data.summary || generateSummary();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 节点名称 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <CodeOutlined style={{ color: getTypeColor(data.type), fontSize: 14 }} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 12,
            fontWeight: 600,
            color: "#8ab4c8",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.name}
        </span>
      </div>

      {/* 类型标签 */}
      <div style={{ marginBottom: 12 }}>
        <Tag
          color={getTypeColor(data.type)}
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 9,
            margin: 0,
            border: "none",
          }}
        >
          {data.type}
        </Tag>
      </div>

      {/* 文件路径 */}
      <div
        style={{
          background: "rgba(10,15,22,0.6)",
          border: "1px solid #1a2535",
          borderRadius: 4,
          padding: 8,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 4,
          }}
        >
          <FileTextOutlined style={{ color: "#4a6a7a", fontSize: 10 }} />
          <span
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 9,
              color: "#4a6a7a",
            }}
          >
            文件
          </span>
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 10,
            color: "#6b8aaa",
            wordBreak: "break-all",
            lineHeight: 1.5,
          }}
        >
          {data.file}
        </div>
      </div>

      {/* 方法签名 */}
      {data.signature && (
        <div
          style={{
            background: "rgba(176,142,255,0.04)",
            border: "1px solid #b08eff22",
            borderRadius: 4,
            padding: 8,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 9,
              color: "#4a6a7a",
              marginBottom: 4,
            }}
          >
            签名
          </div>
          <div
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 10,
              color: "#b08eff",
              wordBreak: "break-all",
              lineHeight: 1.5,
            }}
          >
            {data.signature}
          </div>
        </div>
      )}

      {/* 关系统计 */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 16,
              fontWeight: 700,
              color: "#00d4ff",
            }}
          >
            {data.callCount}
          </span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 9,
              color: "#3a5a6a",
            }}
          >
            调用
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 16,
              fontWeight: 700,
              color: "#ffc145",
            }}
          >
            {data.calledByCount}
          </span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 9,
              color: "#3a5a6a",
            }}
          >
            被调用
          </span>
        </div>
      </div>

      {/* 折叠面板：功能说明和总结 */}
      <Collapse
        activeKey={activeKeys}
        onChange={(keys) => setActiveKeys(keys as string[])}
        expandIcon={({ isActive }) => <DownOutlined rotate={isActive ? 0 : -90} style={{ fontSize: 10, color: "#4a6a7a" }} />}
        style={{
          background: "transparent",
          border: "none",
          marginBottom: 12,
        }}
        items={[
          {
            key: "description",
            label: (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <InfoCircleOutlined style={{ color: "#00d4ff", fontSize: 12 }} />
                <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: "#00d4ff" }}>
                  功能说明
                </span>
              </div>
            ),
            children: (
              <div
                style={{
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 11,
                  color: "#8ab4c8",
                  lineHeight: 1.6,
                }}
              >
                {description}
              </div>
            ),
            style: {
              background: "rgba(0,212,255,0.04)",
              border: "1px solid #00d4ff22",
              borderRadius: 4,
            },
          },
          {
            key: "summary",
            label: (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <AppstoreOutlined style={{ color: "#00f084", fontSize: 12 }} />
                <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: "#00f084" }}>
                  总结
                </span>
              </div>
            ),
            children: (
              <div
                style={{
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 11,
                  color: "#8ab4c8",
                  lineHeight: 1.6,
                }}
              >
                {summary}
              </div>
            ),
            style: {
              background: "rgba(0,240,132,0.04)",
              border: "1px solid #00f08422",
              borderRadius: 4,
            },
          },
        ]}
      />

    </div>
  );
};

// ─── 子组件：统计项 ────────────────────────────────────────────────────────

const StatItem: React.FC<{
  label: string;
  value: number;
  color: string;
}> = ({ label, value, color }) => (
  <div
    style={{
      background: "rgba(10,15,22,0.6)",
      border: "1px solid #1a2535",
      borderRadius: 4,
      padding: "8px 10px",
    }}
  >
    <div
      style={{
        fontFamily: "'IBM Plex Mono'",
        fontSize: 14,
        fontWeight: 700,
        color,
      }}
    >
      {value.toLocaleString()}
    </div>
    <div
      style={{
        fontFamily: "'IBM Plex Mono'",
        fontSize: 9,
        color: "#4a6a7a",
      }}
    >
      {label}
    </div>
  </div>
);

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    Controller: "#00d4ff",
    controller: "#00d4ff",
    Service: "#00f084",
    service: "#00f084",
    Repository: "#ffc145",
    repository: "#ffc145",
    Function: "#b08eff",
    function: "#b08eff",
    Class: "#b08eff",
    class: "#b08eff",
    Component: "#00d4ff",
    component: "#00d4ff",
    Database: "#b08eff",
    database: "#b08eff",
  };
  return colors[type] || "#8ab4c8";
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const DomainInfoPanel: React.FC<DomainInfoPanelProps> = ({
  type,
  data,
  domainInfo,
  loading,
  onViewDetail,
}) => {
  // 空状态
  if (!type || !data) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#3a5a6a",
        }}
      >
        <AppstoreOutlined style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }} />
        <div
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 10,
            letterSpacing: "0.1em",
          }}
        >
          点击节点查看信息
        </div>
      </div>
    );
  }

  // 加载状态
  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <Spin />
        <div
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 10,
            color: "#4a6a7a",
            marginTop: 12,
          }}
        >
          加载中...
        </div>
      </div>
    );
  }

  // 领域面板
  if (type === "domain") {
    return (
      <DomainPanel
        data={data as DomainDescription}
        domainInfo={domainInfo}
        onViewDetail={onViewDetail}
      />
    );
  }

  // 节点面板
  return <NodePanel data={data as NodeDetail} />;
};

export default DomainInfoPanel;
