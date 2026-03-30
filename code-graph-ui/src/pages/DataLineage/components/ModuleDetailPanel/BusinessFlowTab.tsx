/**
 * BusinessFlowTab - 业务流程 Tab 组件。
 *
 * 列表展示模块的所有业务流程：
 * - 流程名称和描述
 * - 触发条件
 * - 步骤时间线
 * - 输入/输出数据
 */
import React from "react";
import { Tag, Collapse } from "antd";
import {
  ThunderboltOutlined,
  ImportOutlined,
  ExportOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import type { BusinessFlow } from "../../types/dataLineage";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface BusinessFlowTabProps {
  businessFlows: BusinessFlow[];
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const BusinessFlowTab: React.FC<BusinessFlowTabProps> = ({ businessFlows }) => {
  if (!businessFlows.length) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: 24,
          color: "#5a6a8a",
          fontFamily: "'IBM Plex Mono'",
          fontSize: 11,
        }}
      >
        暂无业务流程数据
      </div>
    );
  }

  const collapseItems = businessFlows.map((flow) => ({
    key: flow.id,
    label: (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ThunderboltOutlined style={{ color: "#ffc145", fontSize: 13 }} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 12,
            fontWeight: 600,
            color: "#d0e0f0",
          }}
        >
          {flow.name}
        </span>
        <Tag
          style={{
            background: "rgba(255, 193, 69, 0.15)",
            border: "none",
            fontFamily: "'IBM Plex Mono'",
            fontSize: 9,
            color: "#ffc145",
          }}
        >
          {flow.steps.length} 步骤
        </Tag>
      </div>
    ),
    children: <FlowDetail flow={flow} />,
  }));

  return (
    <Collapse
      items={collapseItems}
      defaultActiveKey={[businessFlows[0]?.id]}
      ghost
      style={{ background: "transparent" }}
      expandIcon={({ isActive }) => (
        <span
          style={{
            color: "#7888a8",
            fontSize: 10,
            transform: isActive ? "rotate(90deg)" : "none",
            transition: "transform 0.2s",
          }}
        >
          ▶
        </span>
      )}
    />
  );
};

// ─── 流程详情 ────────────────────────────────────────────────────────────────

const FlowDetail: React.FC<{ flow: BusinessFlow }> = ({ flow }) => {
  return (
    <div style={{ padding: "8px 0" }}>
      {/* 描述 */}
      <div
        style={{
          fontFamily: "'IBM Plex Mono'",
          fontSize: 10,
          color: "#7888a8",
          marginBottom: 12,
          lineHeight: 1.5,
        }}
      >
        {flow.description}
      </div>

      {/* 触发条件 */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 9,
            color: "#5a6a8a",
            marginBottom: 4,
          }}
        >
          触发条件
        </div>
        <Tag
          style={{
            background: "rgba(0, 240, 132, 0.1)",
            border: "1px solid rgba(0, 240, 132, 0.2)",
            fontFamily: "'IBM Plex Mono'",
            fontSize: 10,
            color: "#00f084",
          }}
        >
          {flow.trigger}
        </Tag>
      </div>

      {/* 步骤时间线 */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 9,
            color: "#5a6a8a",
            marginBottom: 8,
          }}
        >
          执行步骤
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {flow.steps.map((step, index) => (
            <div
              key={step.step}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              {/* 步骤号 */}
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: index === 0
                    ? "rgba(0, 212, 255, 0.2)"
                    : index === flow.steps.length - 1
                      ? "rgba(0, 240, 132, 0.2)"
                      : "rgba(176, 142, 255, 0.2)",
                  border:
                    index === 0
                      ? "1px solid #00d4ff"
                      : index === flow.steps.length - 1
                        ? "1px solid #00f084"
                        : "1px solid #b08eff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 10,
                  fontWeight: 600,
                  color:
                    index === 0
                      ? "#00d4ff"
                      : index === flow.steps.length - 1
                        ? "#00f084"
                        : "#b08eff",
                  flexShrink: 0,
                }}
              >
                {step.step}
              </div>

              {/* 步骤内容 */}
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: "'Syne', sans-serif",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#d0e0f0",
                    marginBottom: 2,
                  }}
                >
                  {step.name}
                </div>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono'",
                    fontSize: 9,
                    color: "#7888a8",
                    lineHeight: 1.4,
                  }}
                >
                  {step.description}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 输入输出 */}
      <div style={{ display: "flex", gap: 16 }}>
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginBottom: 4,
            }}
          >
            <ImportOutlined style={{ fontSize: 10, color: "#00d4ff" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#5a6a8a",
              }}
            >
              输入
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {flow.dataInputs.map((input) => (
              <Tag
                key={input}
                style={{
                  background: "rgba(0, 212, 255, 0.08)",
                  border: "none",
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 9,
                  color: "#00d4ff",
                  margin: 0,
                }}
              >
                {input}
              </Tag>
            ))}
          </div>
        </div>
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginBottom: 4,
            }}
          >
            <ExportOutlined style={{ fontSize: 10, color: "#00f084" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#5a6a8a",
              }}
            >
              输出
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {flow.dataOutputs.map((output) => (
              <Tag
                key={output}
                style={{
                  background: "rgba(0, 240, 132, 0.08)",
                  border: "none",
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 9,
                  color: "#00f084",
                  margin: 0,
                }}
              >
                {output}
              </Tag>
            ))}
          </div>
        </div>
      </div>

      {/* 关联服务 */}
      {flow.relatedServices.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginBottom: 4,
            }}
          >
            <AppstoreOutlined style={{ fontSize: 10, color: "#b08eff" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#5a6a8a",
              }}
            >
              关联服务
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {flow.relatedServices.map((service) => (
              <Tag
                key={service}
                style={{
                  background: "rgba(176, 142, 255, 0.08)",
                  border: "none",
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 9,
                  color: "#b08eff",
                  margin: 0,
                }}
              >
                {service}
              </Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BusinessFlowTab;
