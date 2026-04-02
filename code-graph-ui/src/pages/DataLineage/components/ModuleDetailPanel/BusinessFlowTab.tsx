/**
 * BusinessFlowTab - 业务流程 Tab 组件。
 *
 * 重点展示业务流程可视化：
 * - 流程选择器（横向标签）
 * - 步骤节点连线图
 * - 数据输入/输出卡片
 * - 关联服务列表
 */
import React, { useState } from "react";
import {
  ThunderboltOutlined,
  ImportOutlined,
  ExportOutlined,
  AppstoreOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import type { BusinessFlow } from "../../types/dataLineage";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface BusinessFlowTabProps {
  businessFlows: BusinessFlow[];
  moduleColor: string;
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const BusinessFlowTab: React.FC<BusinessFlowTabProps> = ({
  businessFlows,
  moduleColor,
}) => {
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(
    businessFlows[0]?.id || null,
  );

  if (!businessFlows.length) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: 40,
          color: "#95b0d1",
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 12,
        }}
      >
        <ThunderboltOutlined
          style={{
            fontSize: 32,
            opacity: 0.3,
            marginBottom: 12,
            display: "block",
          }}
        />
        暂无业务流程数据
      </div>
    );
  }

  const selectedFlow =
    businessFlows.find((f) => f.id === selectedFlowId) || businessFlows[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 流程选择器 */}
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          padding: "4px 0",
        }}
      >
        {businessFlows.map((flow) => (
          <button
            key={flow.id}
            onClick={() => setSelectedFlowId(flow.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              background:
                selectedFlowId === flow.id
                  ? `${moduleColor}15`
                  : "rgba(255,255,255,0.02)",
              color: selectedFlowId === flow.id ? moduleColor : "#b3c7e4",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s ease",
              boxShadow:
                selectedFlowId === flow.id
                  ? `0 0 0 1px ${moduleColor}40`
                  : "none",
            }}
          >
            <ThunderboltOutlined style={{ fontSize: 10 }} />
            {flow.name}
          </button>
        ))}
      </div>

      {/* 选中流程详情 */}
      {selectedFlow && (
        <FlowDetail flow={selectedFlow} moduleColor={moduleColor} />
      )}
    </div>
  );
};

// ─── 流程详情 ────────────────────────────────────────────────────────────────

const FlowDetail: React.FC<{ flow: BusinessFlow; moduleColor: string }> = ({
  flow,
  moduleColor,
}) => {
  return (
    <div
      style={{
        background: "rgba(16, 22, 32, 0.6)",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.04)",
        overflow: "hidden",
      }}
    >
      {/* 头部：流程描述 + 触发条件 */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.03)",
          background: `${moduleColor}04`,
        }}
      >
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: "#a9bfdc",
            lineHeight: 1.5,
            marginBottom: 8,
          }}
        >
          {flow.description}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <PlayCircleOutlined style={{ fontSize: 11, color: "#00f084" }} />
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: "#b6c9e8",
            }}
          >
            触发：
          </span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: "#00f084",
              padding: "2px 8px",
              background: "rgba(0, 240, 132, 0.08)",
              borderRadius: 4,
            }}
          >
            {flow.trigger}
          </span>
        </div>
      </div>

      {/* 步骤可视化 */}
      <div style={{ padding: "14px" }}>
        <div
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: "#c0d1e9",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <ClockCircleOutlined style={{ fontSize: 12, color: moduleColor }} />
          执行步骤
        </div>

        {/* 步骤节点 */}
        <div style={{ position: "relative" }}>
          {flow.steps.map((step, index) => (
            <StepNode
              key={step.step}
              step={step}
              index={index}
              totalSteps={flow.steps.length}
              moduleColor={moduleColor}
            />
          ))}
        </div>
      </div>

      {/* 数据流卡片 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          padding: "0 14px 14px",
        }}
      >
        {/* 输入 */}
        <DataCard
          title="数据输入"
          icon={<ImportOutlined />}
          items={flow.dataInputs}
          color="#00d4ff"
        />
        {/* 输出 */}
        <DataCard
          title="数据输出"
          icon={<ExportOutlined />}
          items={flow.dataOutputs}
          color="#00f084"
        />
      </div>

      {/* 关联服务 */}
      {flow.relatedServices.length > 0 && (
        <div
          style={{
            padding: "10px 14px",
            borderTop: "1px solid rgba(255,255,255,0.03)",
            background: "rgba(0,0,0,0.15)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 6,
            }}
          >
            <AppstoreOutlined style={{ fontSize: 10, color: "#00d4ff" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: "#b6c9e8",
              }}
            >
              关联服务
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {flow.relatedServices.map((service) => (
              <span
                key={service}
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: "#00d4ff",
                  padding: "3px 8px",
                  background: "rgba(0, 212, 255, 0.08)",
                  borderRadius: 4,
                }}
              >
                {service}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── 步骤节点组件 ─────────────────────────────────────────────────────────────

const StepNode: React.FC<{
  step: BusinessFlow["steps"][0];
  index: number;
  totalSteps: number;
  moduleColor: string;
}> = ({ step, index, totalSteps, moduleColor }) => {
  const isFirst = index === 0;
  const isLast = index === totalSteps - 1;

  // 根据位置决定颜色
  const getNodeColor = () => {
    if (isFirst) return "#00d4ff";
    if (isLast) return "#00f084";
    return moduleColor;
  };
  const nodeColor = getNodeColor();

  return (
    <div style={{ display: "flex", gap: 12 }}>
      {/* 左侧：节点 + 连线 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: 28,
          flexShrink: 0,
        }}
      >
        {/* 节点圆圈 */}
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: `${nodeColor}15`,
            border: `2px solid ${nodeColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 16px ${nodeColor}30`,
            zIndex: 1,
          }}
        >
          {isFirst ? (
            <PlayCircleOutlined style={{ fontSize: 12, color: nodeColor }} />
          ) : isLast ? (
            <CheckCircleOutlined style={{ fontSize: 12, color: nodeColor }} />
          ) : (
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                fontWeight: 700,
                color: nodeColor,
              }}
            >
              {step.step}
            </span>
          )}
        </div>

        {/* 连线 */}
        {!isLast && (
          <div
            style={{
              width: 2,
              flex: 1,
              minHeight: 40,
              background: `linear-gradient(180deg, ${nodeColor}40 0%, ${nodeColor}15 100%)`,
              marginTop: 2,
              marginBottom: 2,
            }}
          />
        )}
      </div>

      {/* 右侧：步骤内容 */}
      <div
        style={{
          flex: 1,
          paddingBottom: isLast ? 0 : 14,
        }}
      >
        <div
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: "#d0e0f0",
            marginBottom: 4,
          }}
        >
          {step.name}
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: "#a9bfdc",
            lineHeight: 1.5,
            marginBottom: 8,
          }}
        >
          {step.description}
        </div>

        {/* 输入输出标签 */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {step.input.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ImportOutlined style={{ fontSize: 10, color: "#00d4ff" }} />
              <span style={{ fontSize: 10, color: "#b6c9e8" }}>入:</span>
              <span style={{ fontSize: 10, color: "#00d4ff" }}>
                {step.input.join(", ")}
              </span>
            </div>
          )}
          {step.output.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ExportOutlined style={{ fontSize: 10, color: "#00f084" }} />
              <span style={{ fontSize: 10, color: "#b6c9e8" }}>出:</span>
              <span style={{ fontSize: 10, color: "#00f084" }}>
                {step.output.join(", ")}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── 数据卡片组件 ─────────────────────────────────────────────────────────────

const DataCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  items: string[];
  color: string;
}> = ({ title, icon, items, color }) => (
  <div
    style={{
      background: `${color}06`,
      borderRadius: 6,
      border: `1px solid ${color}15`,
      padding: "10px 12px",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 8,
      }}
    >
      <span style={{ fontSize: 11, color }}>{icon}</span>
      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: "#b3c7e4",
        }}
      >
        {title}
      </span>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {items.map((item) => (
        <span
          key={item}
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color,
            padding: "3px 7px",
            background: `${color}12`,
            borderRadius: 3,
          }}
        >
          {item}
        </span>
      ))}
    </div>
  </div>
);

export default BusinessFlowTab;
