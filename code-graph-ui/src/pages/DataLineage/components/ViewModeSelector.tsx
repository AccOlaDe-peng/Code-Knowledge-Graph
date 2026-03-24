/**
 * ViewModeSelector - 视图模式选择器组件。
 *
 * 用于在技术架构视图和业务领域视图之间切换。
 */
import React from "react";
import { Select, Tooltip } from "antd";
import { AppstoreOutlined, ClusterOutlined, SettingOutlined } from "@ant-design/icons";
import { useViewMode } from "../../../store/lineageStore";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface ViewModeSelectorProps {
  onOpenConfig?: () => void;
  width?: number | string;
}

// ─── 组件 ────────────────────────────────────────────────────────────────────

const ViewModeSelector: React.FC<ViewModeSelectorProps> = ({
  onOpenConfig,
  width = 140,
}) => {
  const { viewMode, setViewMode } = useViewMode();

  const options = [
    {
      value: "tech",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ClusterOutlined style={{ color: "#b08eff" }} />
          <span>技术架构</span>
        </div>
      ),
    },
    {
      value: "business",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AppstoreOutlined style={{ color: "#00f084" }} />
          <span>业务领域</span>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Select
        value={viewMode}
        onChange={setViewMode}
        options={options}
        style={{ width }}
        dropdownStyle={{
          background: "#0a0f16",
          border: "1px solid #1a2535",
        }}
        optionRender={(option) => (
          <div
            style={{
              padding: "4px 8px",
              borderRadius: 4,
              transition: "all 0.15s",
            }}
          >
            {option.label}
          </div>
        )}
      />
      {onOpenConfig && viewMode === "business" && (
        <Tooltip title="管理领域配置">
          <button
            onClick={onOpenConfig}
            style={{
              background: "rgba(10,15,22,0.9)",
              border: "1px solid #1a2535",
              borderRadius: 4,
              padding: "6px 10px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              color: "#8ab4c8",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#00f08444";
              e.currentTarget.style.color = "#00f084";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#1a2535";
              e.currentTarget.style.color = "#8ab4c8";
            }}
          >
            <SettingOutlined />
          </button>
        </Tooltip>
      )}
    </div>
  );
};

export default ViewModeSelector;
