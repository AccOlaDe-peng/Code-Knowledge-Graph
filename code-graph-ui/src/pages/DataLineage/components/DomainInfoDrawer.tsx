/**
 * DomainInfoDrawer - 领域详情抽屉。
 *
 * 显示领域的完整信息，包括 AI 生成的描述、核心服务、数据流向等。
 */
import React from "react";
import { Drawer, Tag, Spin, Empty } from "antd";
import {
  AppstoreOutlined,
  CodeOutlined,
  ShareAltOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import type { DomainDescription, DomainInfo } from "../../../store/lineageStore";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface DomainInfoDrawerProps {
  visible: boolean;
  domain: DomainDescription | null;
  domainInfo?: DomainInfo;
  loading?: boolean;
  onClose: () => void;
}

// ─── 子组件：信息项 ────────────────────────────────────────────────────────

const InfoItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  color?: string;
}> = ({ icon, label, value, color = "#8ab4c8" }) => (
  <div style={{ marginBottom: 16 }}>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 6,
      }}
    >
      {icon}
      <span
        style={{
          fontFamily: "'IBM Plex Mono'",
          fontSize: 10,
          color: "#4a6a7a",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </span>
    </div>
    <div
      style={{
        fontFamily: "'IBM Plex Mono'",
        fontSize: 12,
        color,
        lineHeight: 1.6,
        paddingLeft: 22,
      }}
    >
      {value}
    </div>
  </div>
);

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const DomainInfoDrawer: React.FC<DomainInfoDrawerProps> = ({
  visible,
  domain,
  domainInfo,
  loading,
  onClose,
}) => {
  return (
    <Drawer
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: domainInfo?.color || "#00f084",
              boxShadow: `0 0 12px ${domainInfo?.color || "#00f084"}88`,
            }}
          />
          <span
            style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 600,
              color: domainInfo?.color || "#00f084",
            }}
          >
            {domainInfo?.name || domain?.domainId || "领域详情"}
          </span>
        </div>
      }
      placement="right"
      width={480}
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
            加载领域信息...
          </div>
        </div>
      ) : domain ? (
        <div>
          {/* 统计概览 */}
          {domainInfo && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
                marginBottom: 20,
              }}
            >
              <StatCard
                label="节点"
                value={domainInfo.nodeCount}
                color="#b08eff"
              />
              <StatCard
                label="服务"
                value={domainInfo.serviceCount}
                color="#00f084"
              />
              <StatCard
                label="控制器"
                value={domainInfo.controllerCount}
                color="#00d4ff"
              />
              <StatCard
                label="跨领域"
                value={domainInfo.crossDomainCalls}
                color="#ff6b6b"
              />
            </div>
          )}

          {/* AI 功能摘要 */}
          <InfoItem
            icon={<AppstoreOutlined style={{ color: "#00f084", fontSize: 12 }} />}
            label="功能摘要"
            color="#b0c4d8"
            value={
              domain.summary || (
                <span style={{ color: "#4a6a7a", fontStyle: "italic" }}>
                  暂无 AI 摘要
                </span>
              )
            }
          />

          {/* 核心服务 */}
          <InfoItem
            icon={<CodeOutlined style={{ color: "#00d4ff", fontSize: 12 }} />}
            label="核心服务"
            value={
              domain.coreServices?.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {domain.coreServices.map((service, i) => (
                    <Tag
                      key={i}
                      style={{
                        background: "rgba(0,212,255,0.1)",
                        border: "1px solid #00d4ff33",
                        color: "#00d4ff",
                        fontFamily: "'IBM Plex Mono'",
                        fontSize: 10,
                        margin: 0,
                      }}
                    >
                      {service}
                    </Tag>
                  ))}
                </div>
              ) : (
                <span style={{ color: "#4a6a7a" }}>暂无核心服务信息</span>
              )
            }
          />

          {/* 数据流向模式 */}
          <InfoItem
            icon={<ShareAltOutlined style={{ color: "#ffc145", fontSize: 12 }} />}
            label="数据流向"
            color="#b0c4d8"
            value={
              domain.dataFlowPattern || (
                <span style={{ color: "#4a6a7a" }}>暂无数据流向描述</span>
              )
            }
          />

          {/* 置信度和生成时间 */}
          <div
            style={{
              marginTop: 24,
              paddingTop: 16,
              borderTop: "1px solid #1a2535",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ClockCircleOutlined style={{ color: "#4a6a7a", fontSize: 11 }} />
              <span
                style={{
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 9,
                  color: "#4a6a7a",
                }}
              >
                {domain.generatedAt
                  ? new Date(domain.generatedAt).toLocaleString("zh-CN")
                  : "未知时间"}
              </span>
            </div>
            <Tag
              style={{
                background:
                  domain.confidence >= 0.8
                    ? "rgba(0,240,132,0.1)"
                    : domain.confidence >= 0.6
                    ? "rgba(255,193,69,0.1)"
                    : "rgba(255,107,107,0.1)",
                border: "none",
                color:
                  domain.confidence >= 0.8
                    ? "#00f084"
                    : domain.confidence >= 0.6
                    ? "#ffc145"
                    : "#ff6b6b",
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                margin: 0,
              }}
            >
              置信度 {(domain.confidence * 100).toFixed(0)}%
            </Tag>
          </div>
        </div>
      ) : (
        <Empty
          description="暂无领域信息"
          style={{ marginTop: 60 }}
          imageStyle={{ height: 60 }}
        />
      )}
    </Drawer>
  );
};

// ─── 子组件：统计卡片 ────────────────────────────────────────────────────────

const StatCard: React.FC<{
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
        fontSize: 18,
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
        marginTop: 2,
      }}
    >
      {label}
    </div>
  </div>
);

export default DomainInfoDrawer;
