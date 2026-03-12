import type { ThemeConfig } from 'antd';
import { theme } from 'antd';

// ─── Node Type Colors ─────────────────────────────────────────────────────────

/**
 * Semantic color palette for graph node types.
 * Each type has a primary color, background, and border variant.
 */
export const NodeTypeColors = {
  Module: {
    primary: '#00d4ff',    // 蓝 - Cyan
    bg: '#0f2838',
    border: '#00d4ff',
    text: '#33dcff',
    dim: 'rgba(0,212,255,0.1)',
  },
  Service: {
    primary: '#00f084',    // 绿 - Green
    bg: '#0f2a1d',
    border: '#00f084',
    text: '#33f59a',
    dim: 'rgba(0,240,132,0.1)',
  },
  API: {
    primary: '#44aaff',    // 青 - Light Blue
    bg: '#0f2235',
    border: '#44aaff',
    text: '#66bbff',
    dim: 'rgba(68,170,255,0.1)',
  },
  Function: {
    primary: '#a8b0c8',    // 灰 - Gray
    bg: '#1e2028',
    border: '#a8b0c8',
    text: '#c0c6dc',
    dim: 'rgba(168,176,200,0.1)',
  },
  Table: {
    primary: '#b08eff',    // 紫 - Purple
    bg: '#1f1830',
    border: '#b08eff',
    text: '#c8a8ff',
    dim: 'rgba(176,142,255,0.1)',
  },
  Event: {
    primary: '#ffc145',    // 橙 - Amber/Orange
    bg: '#282010',
    border: '#ffc145',
    text: '#ffd166',
    dim: 'rgba(255,193,69,0.1)',
  },
  // Additional types
  Component: {
    primary: '#00f084',
    bg: '#0f2a1d',
    border: '#00f084',
    text: '#33f59a',
    dim: 'rgba(0,240,132,0.1)',
  },
  Class: {
    primary: '#b08eff',
    bg: '#1f1830',
    border: '#b08eff',
    text: '#c8a8ff',
    dim: 'rgba(176,142,255,0.1)',
  },
  Database: {
    primary: '#9d7dff',
    bg: '#1d1630',
    border: '#9d7dff',
    text: '#b899ff',
    dim: 'rgba(157,125,255,0.1)',
  },
  Cluster: {
    primary: '#44aaff',
    bg: '#0f2235',
    border: '#44aaff',
    text: '#66bbff',
    dim: 'rgba(68,170,255,0.1)',
  },
  Infrastructure: {
    primary: '#a0a8b8',
    bg: '#1d1e22',
    border: '#a0a8b8',
    text: '#b8c0d0',
    dim: 'rgba(160,168,184,0.1)',
  },
} as const;

export type NodeTypeName = keyof typeof NodeTypeColors;

/**
 * Get color scheme for a node type.
 */
export function getNodeTypeColor(type: string) {
  return NodeTypeColors[type as NodeTypeName] ?? {
    primary: '#9ba8c8',
    bg: '#1a1d26',
    border: '#6b7a9d',
    text: '#b0bcd8',
    dim: 'rgba(155,168,200,0.1)',
  };
}

// ─── Edge Type Colors ─────────────────────────────────────────────────────────

export const EdgeTypeColors = {
  calls: '#33f59a',       // Green - function calls (提亮)
  depends_on: '#33dcff',  // Cyan - module dependencies (提亮)
  imports: '#c8a8ff',     // Purple - imports (提亮)
  contains: '#6b7a9d',    // Gray - containment (提亮)
  reads: '#ffd166',       // Amber - data reads (提亮)
  writes: '#ff8888',      // Red - data writes (提亮)
  produces: '#ffe066',    // Yellow - event production (提亮)
  consumes: '#ffaa66',    // Orange - event consumption (提亮)
  publishes: '#66bbff',   // Light blue - message publishing (提亮)
  subscribes: '#99e877',  // Light green - message subscription (提亮)
} as const;

export type EdgeTypeName = keyof typeof EdgeTypeColors;

/**
 * Get color for an edge type.
 */
export function getEdgeTypeColor(type: string): string {
  return EdgeTypeColors[type as EdgeTypeName] ?? '#6b7a9d';
}

// ─── Ant Design Theme Configuration ───────────────────────────────────────────

/**
 * Mission Control Dark theme for Ant Design.
 * Matches the design system defined in global.css.
 */
export const antdTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    // ── Colors ──────────────────────────────────────────────────────────────────
    colorPrimary: '#00d4ff',          // Cyan accent
    colorSuccess: '#00f084',          // Green
    colorWarning: '#ffc145',          // Amber
    colorError: '#ff4568',            // Red
    colorInfo: '#00d4ff',             // Cyan

    // ── Backgrounds ─────────────────────────────────────────────────────────────
    colorBgBase: '#0c0f16',           // --s-base
    colorBgContainer: '#111520',      // --s-raised
    colorBgElevated: '#1e2234',       // --s-overlay
    colorBgSpotlight: '#171b28',      // --s-float

    // ── Borders ─────────────────────────────────────────────────────────────────
    colorBorder: 'rgba(255,255,255,0.1)',
    colorBorderSecondary: 'rgba(255,255,255,0.06)',

    // ── Text ────────────────────────────────────────────────────────────────────
    colorText: '#e8ecf8',             // --t-primary
    colorTextSecondary: '#9ba8c8',    // --t-secondary
    colorTextTertiary: '#6b7a9d',     // --t-muted

    // ── Typography ──────────────────────────────────────────────────────────────
    fontFamily: "'Syne', -apple-system, sans-serif",
    fontSize: 14,
    fontSizeHeading1: 32,
    fontSizeHeading2: 26,
    fontSizeHeading3: 20,
    fontSizeHeading4: 16,
    fontSizeHeading5: 14,
    lineHeight: 1.6,
    lineHeightHeading1: 1.3,
    lineHeightHeading2: 1.35,
    lineHeightHeading3: 1.4,

    // ── Layout ──────────────────────────────────────────────────────────────────
    borderRadius: 4,
    borderRadiusLG: 6,
    borderRadiusSM: 3,
    controlHeight: 36,
    controlHeightLG: 42,
    controlHeightSM: 28,

    // ── Motion ──────────────────────────────────────────────────────────────────
    motionDurationSlow: '0.3s',
    motionDurationMid: '0.2s',
    motionDurationFast: '0.12s',
  },

  components: {
    // ── Layout ────────────────────────────────────────────────────────────────
    Layout: {
      siderBg: '#0a0d13',
      headerBg: '#0a0d13',
      bodyBg: '#07090d',
      footerBg: '#0a0d13',
    },

    // ── Menu ──────────────────────────────────────────────────────────────────
    Menu: {
      darkItemBg: '#0a0d13',
      darkSubMenuItemBg: '#0a0d13',
      darkItemSelectedBg: 'rgba(0,212,255,0.1)',
      darkItemHoverBg: 'rgba(255,255,255,0.04)',
      darkItemColor: '#9ba8c8',
      darkItemSelectedColor: '#00d4ff',
      darkItemHoverColor: '#e8ecf8',
    },

    // ── Table ─────────────────────────────────────────────────────────────────
    Table: {
      rowHoverBg: '#171b28',
      borderColor: 'rgba(255,255,255,0.08)',
      headerBg: '#171b28',
      headerColor: '#9ba8c8',
      bodySortBg: '#111520',
    },

    // ── Card ──────────────────────────────────────────────────────────────────
    Card: {
      colorBgContainer: '#111520',
      colorBorderSecondary: 'rgba(255,255,255,0.08)',
      headerBg: 'transparent',
      headerFontSize: 13,
      headerFontSizeSM: 12,
    },

    // ── Button ────────────────────────────────────────────────────────────────
    Button: {
      primaryColor: '#07090d',
      primaryShadow: '0 0 18px rgba(0,212,255,0.22)',
      defaultBg: '#171b28',
      defaultBorderColor: 'rgba(255,255,255,0.20)',
      defaultColor: '#e8ecf8',
      defaultHoverBg: '#1e2234',
      defaultHoverBorderColor: '#00d4ff',
      defaultHoverColor: '#00d4ff',
    },

    // ── Input ─────────────────────────────────────────────────────────────────
    Input: {
      colorBgContainer: '#171b28',
      colorBorder: 'rgba(255,255,255,0.12)',
      colorText: '#e8ecf8',
      colorTextPlaceholder: '#6b7a9d',
      activeBorderColor: '#00d4ff',
      activeShadow: '0 0 0 2px rgba(0,212,255,0.12)',
      hoverBorderColor: 'rgba(0,212,255,0.5)',
    },

    // ── Select ────────────────────────────────────────────────────────────────
    Select: {
      colorBgContainer: '#171b28',
      colorBgElevated: '#1e2234',
      colorBorder: 'rgba(255,255,255,0.12)',
      colorText: '#e8ecf8',
      colorTextPlaceholder: '#6b7a9d',
      optionActiveBg: '#171b28',
      optionSelectedBg: 'rgba(0,212,255,0.1)',
      optionSelectedColor: '#00d4ff',
    },

    // ── Tag ───────────────────────────────────────────────────────────────────
    Tag: {
      defaultBg: 'rgba(155,168,200,0.1)',
      defaultColor: '#9ba8c8',
    },

    // ── Alert ─────────────────────────────────────────────────────────────────
    Alert: {
      colorInfoBg: 'rgba(0,212,255,0.07)',
      colorInfoBorder: 'rgba(0,212,255,0.2)',
      colorSuccessBg: 'rgba(0,240,132,0.07)',
      colorSuccessBorder: 'rgba(0,240,132,0.2)',
      colorWarningBg: 'rgba(255,193,69,0.07)',
      colorWarningBorder: 'rgba(255,193,69,0.2)',
      colorErrorBg: 'rgba(255,69,104,0.07)',
      colorErrorBorder: 'rgba(255,69,104,0.2)',
    },

    // ── Progress ──────────────────────────────────────────────────────────────
    Progress: {
      defaultColor: '#00d4ff',
      remainingColor: '#171b28',
    },

    // ── Switch ────────────────────────────────────────────────────────────────
    Switch: {
      colorPrimary: '#00d4ff',
      colorPrimaryHover: '#33dcff',
    },

    // ── Pagination ────────────────────────────────────────────────────────────
    Pagination: {
      itemBg: '#171b28',
      itemActiveBg: 'rgba(0,212,255,0.1)',
      itemLinkBg: '#171b28',
      itemActiveBgDisabled: '#111520',
    },

    // ── Tooltip ───────────────────────────────────────────────────────────────
    Tooltip: {
      colorBgSpotlight: '#1e2234',
      colorTextLightSolid: '#e8ecf8',
    },

    // ── Modal ─────────────────────────────────────────────────────────────────
    Modal: {
      contentBg: '#111520',
      headerBg: '#111520',
      titleColor: '#e8ecf8',
    },

    // ── Drawer ────────────────────────────────────────────────────────────────
    Drawer: {
      colorBgElevated: '#111520',
    },

    // ── Divider ───────────────────────────────────────────────────────────────
    Divider: {
      colorSplit: 'rgba(255,255,255,0.045)',
    },

    // ── Spin ──────────────────────────────────────────────────────────────────
    Spin: {
      colorPrimary: '#00d4ff',
    },

    // ── Statistic ─────────────────────────────────────────────────────────────
    Statistic: {
      titleFontSize: 10,
      contentFontSize: 24,
    },
  },
};

// ─── CSS Variable Exports ─────────────────────────────────────────────────────

/**
 * Export node type colors as CSS custom properties.
 * Can be injected into :root for global access.
 */
export function generateNodeTypeCSS(): string {
  return Object.entries(NodeTypeColors)
    .map(([type, colors]) => {
      const prefix = `--node-${type.toLowerCase()}`;
      return `
  ${prefix}-primary: ${colors.primary};
  ${prefix}-bg: ${colors.bg};
  ${prefix}-border: ${colors.border};
  ${prefix}-text: ${colors.text};
  ${prefix}-dim: ${colors.dim};`;
    })
    .join('');
}

/**
 * Export edge type colors as CSS custom properties.
 */
export function generateEdgeTypeCSS(): string {
  return Object.entries(EdgeTypeColors)
    .map(([type, color]) => `  --edge-${type.replace('_', '-')}: ${color};`)
    .join('\n');
}

// ─── Utility Functions ────────────────────────────────────────────────────────

/**
 * Get Ant Design tag color for a node type.
 */
export function getNodeTypeTagColor(type: string): string {
  const colorMap: Record<string, string> = {
    Module: 'blue',
    Service: 'green',
    API: 'geekblue',
    Function: 'default',
    Table: 'purple',
    Event: 'orange',
    Component: 'green',
    Class: 'purple',
    Database: 'purple',
    Cluster: 'blue',
    Infrastructure: 'default',
  };
  return colorMap[type] ?? 'default';
}

/**
 * Get status color (for confidence, health, etc.)
 */
export function getStatusColor(value: number): string {
  if (value >= 0.8) return '#00f084'; // Green - excellent
  if (value >= 0.6) return '#ffc145'; // Amber - good
  if (value >= 0.4) return '#ff9955'; // Orange - fair
  return '#ff4568'; // Red - poor
}

/**
 * Get depth color for impact analysis.
 */
export function getDepthColor(depth: number): string {
  if (depth === 0) return '#ff4568'; // Source - red
  if (depth === 1) return '#ff8844'; // Direct - orange
  if (depth === 2) return '#ffc145'; // Secondary - amber
  return '#00d4ff'; // Tertiary+ - cyan
}
