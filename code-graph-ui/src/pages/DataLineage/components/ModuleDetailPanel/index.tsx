/**
 * ModuleDetailPanel - 模块详情面板组件。
 *
 * 可折叠、可拖拽调整高度的面板，展示选中模块的详情：
 * - 三个 Tab：业务流程（优先）、实体、功能
 * - 顶部显示模块名称和描述
 * - 支持拖拽调整面板高度
 */
import React, { useState, useRef, useCallback, useEffect } from "react";
import { Button, Tooltip } from "antd";
import {
  DatabaseOutlined,
  ThunderboltOutlined,
  ApiOutlined,
  DownOutlined,
  RightOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
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

// ─── 常量 ────────────────────────────────────────────────────────────────────

const MIN_HEIGHT = 200;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 380;

// ─── Tab 配置 ────────────────────────────────────────────────────────────────

const TAB_ITEMS = [
  {
    key: "flows",
    label: "业务流程",
    icon: <ThunderboltOutlined />,
    color: "#ffc145",
  },
  {
    key: "entities",
    label: "实体",
    icon: <DatabaseOutlined />,
    color: "#b08eff",
  },
  {
    key: "functions",
    label: "功能",
    icon: <ApiOutlined />,
    color: "#00d4ff",
  },
];

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const ModuleDetailPanel: React.FC<ModuleDetailPanelProps> = ({
  module,
  collapsed = false,
  onCollapseChange,
}) => {
  const [activeTab, setActiveTab] = useState("flows");
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // 拖拽处理
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = isFullscreen ? DEFAULT_HEIGHT : panelHeight;
  }, [panelHeight, isFullscreen]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = dragStartY.current - e.clientY;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragStartHeight.current + deltaY));
      setPanelHeight(newHeight);
      if (isFullscreen) setIsFullscreen(false);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isFullscreen]);

  // 全屏切换
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // 计算实际高度
  const actualHeight = collapsed ? 48 : (isFullscreen ? MAX_HEIGHT : panelHeight);

  // 模块为空时的占位
  if (!module) {
    return (
      <div
        style={{
          height: 120,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(10, 15, 22, 0.6)",
          borderTop: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, opacity: 0.04, marginBottom: 10 }}>◈</div>
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: "#4a5a7a",
              letterSpacing: "0.05em",
            }}
          >
            点击模块查看详情
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      style={{
        height: actualHeight,
        flexShrink: 0,
        background: `linear-gradient(180deg, rgba(10, 14, 20, 0.98) 0%, rgba(6, 8, 12, 0.99) 100%)`,
        borderTop: `1px solid ${module.color}30`,
        transition: isDragging ? "none" : "height 0.2s ease",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 拖拽手柄 */}
      {!collapsed && (
        <div
          onMouseDown={handleMouseDown}
          style={{
            height: 8,
            cursor: "ns-resize",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 40,
              height: 3,
              borderRadius: 2,
              background: isDragging ? module.color : "rgba(120, 136, 168, 0.3)",
              transition: "background 0.2s",
            }}
          />
        </div>
      )}

      {/* 头部 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          paddingBottom: collapsed ? 10 : 6,
          background: `linear-gradient(90deg, ${module.color}08 0%, transparent 50%)`,
          borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.03)",
        }}
      >
        {/* 左侧：模块信息 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* 图标 */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              background: `linear-gradient(135deg, ${module.color}20 0%, ${module.color}08 100%)`,
              border: `1px solid ${module.color}30`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: module.color,
                boxShadow: `0 0 12px ${module.color}88`,
              }}
            />
          </div>

          {/* 名称 */}
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  fontFamily: "'Syne', sans-serif",
                  fontSize: 15,
                  fontWeight: 700,
                  color: module.color,
                  letterSpacing: "-0.01em",
                }}
              >
                {module.name}
              </span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: "#7888a8",
                  letterSpacing: "0.02em",
                }}
              >
                {module.fullName}
              </span>
            </div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: "#98a8c8",
                marginTop: 2,
                maxWidth: 320,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {module.description}
            </div>
          </div>
        </div>

        {/* 右侧：操作按钮 */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {/* 统计徽章 */}
          <div style={{ display: "flex", gap: 6, marginRight: 8 }}>
            <StatBadge count={module.entities.length} label="实体" color="#b08eff" />
            <StatBadge count={module.businessFlows.length} label="流程" color="#ffc145" />
            <StatBadge count={module.subFunctions.length} label="功能" color="#00d4ff" />
          </div>

          {/* 全屏按钮 */}
          {!collapsed && (
            <Tooltip title={isFullscreen ? "退出全屏" : "全屏"}>
              <Button
                type="text"
                size="small"
                icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={toggleFullscreen}
                style={{ color: "#7888a8", fontSize: 12 }}
              />
            </Tooltip>
          )}

          {/* 折叠按钮 */}
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
      </div>

      {/* 内容区 */}
      {!collapsed && (
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            paddingTop: 4,
          }}
        >
          {/* Tab 栏 */}
          <div
            style={{
              display: "flex",
              gap: 2,
              padding: "0 16px",
              borderBottom: "1px solid rgba(255,255,255,0.03)",
            }}
          >
            {TAB_ITEMS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  border: "none",
                  background: activeTab === tab.key ? `${tab.color}12` : "transparent",
                  color: activeTab === tab.key ? tab.color : "#6a7a9a",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "pointer",
                  borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : "2px solid transparent",
                  marginBottom: -1,
                  transition: "all 0.15s ease",
                }}
              >
                <span style={{ fontSize: 12 }}>{React.cloneElement(tab.icon, { style: { color: activeTab === tab.key ? tab.color : "#6a7a9a" } })}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab 内容 */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "12px 16px",
            }}
          >
            {activeTab === "entities" && <EntityTab entities={module.entities} moduleColor={module.color} />}
            {activeTab === "flows" && <BusinessFlowTab businessFlows={module.businessFlows} moduleColor={module.color} />}
            {activeTab === "functions" && <FunctionTab subFunctions={module.subFunctions} moduleColor={module.color} />}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── 统计徽章组件 ─────────────────────────────────────────────────────────────

const StatBadge: React.FC<{ count: number; label: string; color: string }> = ({ count, label, color }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 4,
      padding: "2px 8px",
      borderRadius: 4,
      background: `${color}10`,
      border: `1px solid ${color}20`,
    }}
  >
    <span
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
        fontWeight: 600,
        color,
      }}
    >
      {count}
    </span>
    <span
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 9,
        color: "#8898b8",
      }}
    >
      {label}
    </span>
  </div>
);

export default ModuleDetailPanel;
