/**
 * DomainInfoPanel - 右侧固定信息面板。
 *
 * 显示选中领域或节点的简要信息，点击「查看详情」打开抽屉。
 */
import React from "react";
import { Button, Spin, Tag } from "antd";
import {
  AppstoreOutlined,
  CodeOutlined,
  FileTextOutlined,
  RightOutlined,
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
  onViewDetail: () => void;
}

// ─── 子组件：领域面板 ────────────────────────────────────────────────────────

const DomainPanel: React.FC<{
  data: DomainDescription;
  domainInfo?: DomainInfo;
  onViewDetail: () => void;
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

    {/* 查看详情按钮 */}
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
  </div>
);

// ─── 子组件：节点面板 ────────────────────────────────────────────────────────

const NodePanel: React.FC<{
  data: NodeDetail;
  onViewDetail: () => void;
}> = ({ data, onViewDetail }) => (
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

    {/* AI 描述预览 */}
    {data.aiDescription && (
      <div
        style={{
          background: "rgba(0,212,255,0.04)",
          border: "1px solid #00d4ff22",
          borderRadius: 4,
          padding: 10,
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
          AI 描述
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
          {data.aiDescription}
        </div>
      </div>
    )}

    {/* 查看详情按钮 */}
    <div style={{ marginTop: "auto", paddingTop: 12 }}>
      <Button
        type="primary"
        block
        onClick={onViewDetail}
        icon={<RightOutlined />}
        iconPosition="end"
        style={{
          background: "rgba(0,212,255,0.1)",
          border: "1px solid #00d4ff44",
          color: "#00d4ff",
          fontFamily: "'IBM Plex Mono'",
          fontSize: 11,
          height: 36,
        }}
      >
        查看详情
      </Button>
    </div>
  </div>
);

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
    Service: "#00f084",
    Repository: "#ffc145",
    Function: "#b08eff",
    Class: "#b08eff",
    Component: "#00d4ff",
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
  return <NodePanel data={data as NodeDetail} onViewDetail={onViewDetail} />;
};

export default DomainInfoPanel;
