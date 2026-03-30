/**
 * ModuleDetailPanel - 模块详情面板组件。
 *
 * 可折叠面板，展示选中模块的详情：
 * - 三个 Tab：实体、业务流程、功能
 * - 顶部显示模块名称和描述
 */
import React, { useState } from "react";
import { Tabs, Button, Tooltip } from "antd";
import {
  DatabaseOutlined,
  CloudOutlined,
  FunctionOutlined,
  DownOutlined,
  RightOutlined,
} from "@ant-design/icons";
import type { Module } from "../../types/dataLineage";
import EntityTab from "./EntityTab";
import BusinessFlowTab from "./BusinessFlowTab";
import FunctionTab from "./FunctionTab";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface ModuleDetailPanelProps {
  module: Module | null;
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

// ─── Tab 配置 ────────────────────────────────────────────────────────────────

const TAB_ITEMS = [
  {
    key: "entities",
    label: (
      <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12 }}>
        <DatabaseOutlined style={{ marginRight: 6 }} />
        实体
      </span>
    ),
  },
  {
    key: "flows",
    label: (
      <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12 }}>
        <CloudOutlined style={{ marginRight: 6 }} />
        业务流程
      </span>
    ),
  },
  {
    key: "functions",
    label: (
      <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12 }}>
        <FunctionOutlined style={{ marginRight: 6 }} />
        功能
      </span>
    ),
  },
];

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const ModuleDetailPanel: React.FC<ModuleDetailPanelProps> = ({
  module,
  collapsed = false,
  onCollapseChange,
}) => {
  const [activeTab, setActiveTab] = useState("entities");

  if (!module) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(10, 15, 22, 0.5)",
          borderTop: "1px solid var(--b-subtle)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, opacity: 0.06, marginBottom: 8 }}>◈</div>
          <div
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 11,
              color: "#5a6a8a",
            }}
          >
            点击模块查看详情
          </div>
        </div>
      </div>
    );
  }

  const panelHeight = collapsed ? 48 : 320;

  return (
    <div
      style={{
        height: panelHeight,
        background: "rgba(10, 15, 22, 0.95)",
        borderTop: `1px solid ${module.color}44`,
        transition: "height 0.2s ease",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 头部 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          borderBottom: collapsed ? "none" : "1px solid var(--b-subtle)",
          background: `${module.color}08`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: module.color,
              boxShadow: `0 0 8px ${module.color}88`,
            }}
          />
          <div>
            <span
              style={{
                fontFamily: "'Syne', sans-serif",
                fontSize: 14,
                fontWeight: 600,
                color: module.color,
              }}
            >
              {module.name}
            </span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 10,
                color: "#5a6a8a",
                marginLeft: 8,
              }}
            >
              {module.fullName}
            </span>
          </div>
        </div>

        <Tooltip title={collapsed ? "展开" : "折叠"}>
          <Button
            type="text"
            size="small"
            icon={collapsed ? <RightOutlined /> : <DownOutlined />}
            onClick={() => onCollapseChange?.(!collapsed)}
            style={{ color: "#7888a8" }}
          />
        </Tooltip>
      </div>

      {/* 内容区 */}
      {!collapsed && (
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={TAB_ITEMS}
            size="small"
            style={{
              margin: 0,
              padding: "0 12px",
            }}
            tabBarStyle={{
              marginBottom: 0,
            }}
          />

          <div style={{ flex: 1, overflow: "auto", padding: "0 16px 12px" }}>
            {activeTab === "entities" && <EntityTab entities={module.entities} />}
            {activeTab === "flows" && (
              <BusinessFlowTab businessFlows={module.businessFlows} />
            )}
            {activeTab === "functions" && (
              <FunctionTab subFunctions={module.subFunctions} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModuleDetailPanel;
