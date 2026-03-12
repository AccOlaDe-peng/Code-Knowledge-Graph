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
    bg: '#0d1f2d',
    border: '#00d4ff',
    text: '#00d4ff',
    dim: 'rgba(0,212,255,0.1)',
  },
  Service: {
    primary: '#00f084',    // 绿 - Green
    bg: '#0d2118',
    border: '#00f084',
    text: '#00f084',
    dim: 'rgba(0,240,132,0.1)',
  },
  API: {
    primary: '#44aaff',    // 青 - Light Blue
    bg: '#0d1a2a',
    border: '#44aaff',
    text: '#44aaff',
    dim: 'rgba(68,170,255,0.1)',
  },
  Function: {
    primary: '#8c92a8',    // 灰 - Gray
    bg: '#1a1c24',
    border: '#8c92a8',
    text: '#8c92a8',
    dim: 'rgba(140,146,168,0.1)',
  },
  Table: {
    primary: '#b08eff',    // 紫 - Purple
    bg: '#1a1428',
    border: '#b08eff',
    text: '#b08eff',
    dim: 'rgba(176,142,255,0.1)',
  },
  Event: {
    primary: '#ffc145',    // 橙 - Amber/Orange
    bg: '#1d1a0d',
    border: '#ffc145',
    text: '#ffc145',
    dim: 'rgba(255,193,69,0.1)',
  },
  // Additional types
  Component: {
    primary: '#00f084',
    bg: '#0d2118',
    border: '#00f084',
    text: '#00f084',
    dim: 'rgba(0,240,132,0.1)',
  },
  Class: {
    primary: '#b08eff',
    bg: '#1a1428',
    border: '#b08eff',
    text: '#b08eff',
    dim: 'rgba(176,142,255,0.1)',
  },
  Database: {
    primary: '#9d7dff',
    bg: '#1a1228',
    border: '#9d7dff',
    text: '#9d7dff',
    dim: 'rgba(157,125,255,0.1)',
  },
  Cluster: {
    primary: '#44aaff',
    bg: '#0d1a2a',
    border: '#44aaff',
    text: '#44aaff',
    dim: 'rgba(68,170,255,0.1)',
  },
  Infrastructure: {
    primary: '#888899',
    bg: '#1a1a1a',
    border: '#888899',
    text: '#888899',
    dim: 'rgba(136,136,153,0.1)',
  },
} as const;

export type NodeTypeName = keyof typeof NodeTypeColors;

/**
 * Get color scheme for a node type.
 */
export function getNodeTypeColor(type: string) {
  return NodeTypeColors[type as NodeTypeName] ?? {
    primary: '#6e7a99',
    bg: '#13161e',
    border: '#4a5068',
    text: '#6e7a99',
    dim: 'rgba(110,122,153,0.1)',
  };
}

// ─── Edge Type Colors ─────────────────────────────────────────────────────────

export const EdgeTypeColors = {
  calls: '#00f084',       // Green - function calls
  depends_on: '#00d4ff',  // Cyan - module dependencies
  imports: '#b08eff',     // Purple - imports
  contains: '#4a5068',    // Gray - containment
  reads: '#ffc145',       // Amber - data reads
  writes: '#ff6b6b',      // Red - data writes
  produces: '#ffcc44',    // Yellow - event production
  consumes: '#ff9955',    // Orange - event consumption
  publishes: '#44aaff',   // Light blue - message publishing
  subscribes: '#7ed957',  // Light green - message subscription
} as const;

export type EdgeTypeName = keyof typeof EdgeTypeColors;

/**
 * Get color for an edge type.
 */
export function getEdgeTypeColor(type: string): string {
  return EdgeTypeColors[type as EdgeTypeName] ?? '#3d4460';
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
    colorText: '#d0d5e8',             // --t-primary
    colorTextSecondary: '#6e7a99',    // --t-secondary
    colorTextTertiary: '#3d4460',     // --t-muted

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
      darkItemColor: '#6e7a99',
      darkItemSelectedColor: '#00d4ff',
      darkItemHoverColor: '#d0d5e8',
    },

    // ── Table ─────────────────────────────────────────────────────────────────
    Table: {
      rowHoverBg: '#171b28',
      borderColor: 'rgba(255,255,255,0.05)',
      headerBg: '#171b28',
      headerColor: '#6e7a99',
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
      defaultBorderColor: 'rgba(255,255,255,0.14)',
      defaultColor: '#d0d5e8',
      defaultHoverBg: '#1e2234',
      defaultHoverBorderColor: '#00d4ff',
      defaultHoverColor: '#00d4ff',
    },

    // ── Input ─────────────────────────────────────────────────────────────────
    Input: {
      colorBgContainer: '#171b28',
      colorBorder: 'rgba(255,255,255,0.08)',
      colorText: '#d0d5e8',
      colorTextPlaceholder: '#3d4460',
      activeBorderColor: '#00d4ff',
      activeShadow: '0 0 0 2px rgba(0,212,255,0.12)',
      hoverBorderColor: 'rgba(0,212,255,0.5)',
    },

    // ── Select ────────────────────────────────────────────────────────────────
    Select: {
      colorBgContainer: '#171b28',
      colorBgElevated: '#1e2234',
      colorBorder: 'rgba(255,255,255,0.08)',
      colorText: '#d0d5e8',
      colorTextPlaceholder: '#3d4460',
      optionActiveBg: '#171b28',
      optionSelectedBg: 'rgba(0,212,255,0.1)',
      optionSelectedColor: '#00d4ff',
    },

    // ── Tag ───────────────────────────────────────────────────────────────────
    Tag: {
      defaultBg: 'rgba(110,122,153,0.1)',
      defaultColor: '#6e7a99',
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
      colorTextLightSolid: '#d0d5e8',
    },

    // ── Modal ─────────────────────────────────────────────────────────────────
    Modal: {
      contentBg: '#111520',
      headerBg: '#111520',
      titleColor: '#d0d5e8',
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
