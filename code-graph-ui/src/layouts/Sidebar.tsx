import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  IconDashboard,
  IconRepository,
  IconArchitecture,
  IconDataLineage,
  IconEventFlow,
  IconQuery,
  IconCollapse,
  IconExpand,
} from "../components/ui/Icons";
import { useRipple, getRippleStyle } from "../core/hooks/useInteraction";

interface NavItem {
  path: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    path: "/",
    icon: <IconDashboard size={18} />,
    label: "概览",
    description: "系统仪表盘",
  },
  {
    path: "/repository",
    icon: <IconRepository size={18} />,
    label: "仓库",
    description: "代码仓库管理",
  },
  {
    path: "/architecture",
    icon: <IconArchitecture size={18} />,
    label: "架构图",
    description: "模块架构视图",
  },
  {
    path: "/lineage",
    icon: <IconDataLineage size={18} />,
    label: "数据血缘",
    description: "数据流向追踪",
  },
  // { path: '/fieldlineage',  icon: <IconFieldLineage size={18} />, label: '字段血缘', description: '字段级数据流转' },
  {
    path: "/eventflow",
    icon: <IconEventFlow size={18} />,
    label: "事件流",
    description: "事件订阅关系",
  },
  {
    path: "/query",
    icon: <IconQuery size={18} />,
    label: "AI 查询",
    description: "智能代码问答",
  },
];

// ─── Nav Item Component ───────────────────────────────────────────────────────

const NavItemComponent: React.FC<{
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}> = ({ item, active, collapsed, onClick }) => {
  const { ref, ripples, createRipple } = useRipple<HTMLDivElement>();

  return (
    <div
      ref={ref}
      onClick={(e) => {
        createRipple(e);
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: collapsed ? "center" : "flex-start",
        padding: collapsed ? "12px 14px" : "10px 14px",
        gap: 12,
        cursor: "pointer",
        position: "relative",
        color: active ? "#00d4ff" : "#a8b8d8",
        background: active
          ? "linear-gradient(90deg, rgba(0,212,255,0.1) 0%, transparent 100%)"
          : "transparent",
        borderRadius: 8,
        transition: "var(--transition-normal)",
        border: active
          ? "1px solid rgba(0,212,255,0.2)"
          : "1px solid transparent",
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          const el = e.currentTarget as HTMLDivElement;
          el.style.background = "rgba(255,255,255,0.04)";
          el.style.color = "#c8d4e8";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          const el = e.currentTarget as HTMLDivElement;
          el.style.background = "transparent";
          el.style.color = "#a8b8d8";
        }
      }}
    >
      {/* Ripple effects */}
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          style={getRippleStyle(ripple, "rgba(0, 212, 255, 0.25)")}
        />
      ))}

      {/* Active indicator */}
      {active && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            width: 3,
            height: "60%",
            background: "#00d4ff",
            boxShadow: "3px 0 12px rgba(0,212,255,0.6)",
            borderRadius: "0 2px 2px 0",
          }}
        />
      )}

      <span
        style={{
          lineHeight: 1,
          width: 22,
          textAlign: "center",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          filter: active ? "drop-shadow(0 0 6px rgba(0,212,255,0.5))" : "none",
          marginTop: collapsed ? 0 : 2,
        }}
      >
        {item.icon}
      </span>

      {!collapsed && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontFamily: "var(--font-ui)",
              fontWeight: active ? 600 : 500,
              letterSpacing: "0.01em",
              whiteSpace: "nowrap",
              color: active ? "#00d4ff" : "inherit",
            }}
          >
            {item.label}
          </div>
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: active ? "rgba(0,212,255,0.6)" : "#7888a8",
              marginTop: 1,
              whiteSpace: "nowrap",
            }}
          >
            {item.description}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sidebar Component ────────────────────────────────────────────────────────

const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const w = collapsed ? 72 : 260;

  return (
    <aside
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        width: w,
        zIndex: 200,
        background: "linear-gradient(180deg, #080a10 0%, #06080c 100%)",
        borderRight: "1px solid rgba(255,255,255,0.04)",
        display: "flex",
        flexDirection: "column",
        transition: "width var(--duration-normal) var(--ease-out)",
        overflow: "hidden",
      }}
    >
      {/* Logo */}
      <div
        onClick={() => navigate("/")}
        style={{
          height: 60,
          minHeight: 60,
          display: "flex",
          alignItems: "center",
          padding: collapsed ? "0 0 0 22px" : "0 20px",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          gap: 14,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            minWidth: 36,
            background:
              "linear-gradient(135deg, rgba(0,212,255,0.15) 0%, rgba(0,212,255,0.05) 100%)",
            border: "1.5px solid rgba(0,212,255,0.4)",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            color: "#00d4ff",
            fontWeight: 700,
            fontFamily: "var(--font-mono)",
            boxShadow:
              "0 0 20px rgba(0,212,255,0.2), inset 0 0 12px rgba(0,212,255,0.1)",
            flexShrink: 0,
            transition: "var(--transition-normal)",
          }}
        >
          KG
        </div>
        {!collapsed && (
          <div style={{ overflow: "hidden" }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#f0f4fc",
                letterSpacing: "0.02em",
                lineHeight: 1.3,
                fontFamily: "var(--font-ui)",
                whiteSpace: "nowrap",
              }}
            >
              代码图谱
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#7888a8",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
                marginTop: 2,
              }}
            >
              知识系统 v2.0
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav
        style={{
          flex: 1,
          padding: "12px 0",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <div
          style={{
            padding: collapsed ? "0 12px" : "0 12px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {NAV_ITEMS.map((item) => {
            const active =
              item.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.path);
            return (
              <NavItemComponent
                key={item.path}
                item={item}
                active={active}
                collapsed={collapsed}
                onClick={() => navigate(item.path)}
              />
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div
        style={{
          padding: collapsed ? "14px 12px" : "12px 16px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
        }}
      >
        {!collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#00f084",
                boxShadow: "0 0 8px rgba(0,240,132,0.6)",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 12,
                color: "#a8b8d8",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.02em",
              }}
            >
              API 已连接
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            cursor: "pointer",
            color: "#7888a8",
            fontSize: 16,
            padding: "6px 10px",
            borderRadius: 6,
            fontFamily: "var(--font-mono)",
            lineHeight: 1,
            transition: "var(--transition-fast)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: collapsed ? 44 : "auto",
          }}
          onMouseEnter={(e) => {
            const el = e.target as HTMLElement;
            el.style.color = "#00d4ff";
            el.style.borderColor = "rgba(0,212,255,0.3)";
            el.style.background = "rgba(0,212,255,0.08)";
          }}
          onMouseLeave={(e) => {
            const el = e.target as HTMLElement;
            el.style.color = "#7888a8";
            el.style.borderColor = "rgba(255,255,255,0.08)";
            el.style.background = "rgba(255,255,255,0.04)";
          }}
        >
          {collapsed ? <IconExpand size={16} /> : <IconCollapse size={16} />}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
