import type { ThemeConfig } from 'antd';
import { theme } from 'antd';

// ─── Re-export from new color modules ────────────────────────────────────────

// New color system
export { getNodeTypeColor, NODE_TYPE_COLORS } from './nodeTypeColors'
export { getEdgeTypeColor, EDGE_TYPE_COLORS } from './edgeTypeColors'
export { generateNodeColor, generateEdgeColor, BASE_HUES } from './colorGenerator'
export type { NodeTypeColorScheme } from './colorGenerator'

// Backward compatibility aliases
export { NODE_TYPE_COLORS as NodeTypeColors } from './nodeTypeColors'
export { EDGE_TYPE_COLORS as EdgeTypeColors } from './edgeTypeColors'

// Type alias for backward compatibility
export type NodeTypeName = string
export type EdgeTypeName = string

// ─── Ant Design Theme Configuration ───────────────────────────────────────────

/**
 * Professional Dark theme for Ant Design.
 * Enhanced for readability and visual hierarchy.
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
    colorBgBase: '#0a0d14',           // --s-base
    colorBgContainer: '#0f1218',      // --s-raised
    colorBgElevated: '#1a1f2a',       // --s-overlay
    colorBgSpotlight: '#141820',      // --s-float

    // ── Borders ─────────────────────────────────────────────────────────────────
    colorBorder: 'rgba(255,255,255,0.08)',
    colorBorderSecondary: 'rgba(255,255,255,0.05)',

    // ── Text ────────────────────────────────────────────────────────────────────
    colorText: '#f0f4fc',             // --t-primary (enhanced)
    colorTextSecondary: '#a8b8d8',    // --t-secondary (enhanced)
    colorTextTertiary: '#7888a8',     // --t-muted (enhanced)

    // ── Typography ──────────────────────────────────────────────────────────────
    fontFamily: "'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 15,
    fontSizeHeading1: 36,
    fontSizeHeading2: 28,
    fontSizeHeading3: 22,
    fontSizeHeading4: 18,
    fontSizeHeading5: 15,
    lineHeight: 1.6,
    lineHeightHeading1: 1.25,
    lineHeightHeading2: 1.3,
    lineHeightHeading3: 1.35,

    // ── Layout ──────────────────────────────────────────────────────────────────
    borderRadius: 4,
    borderRadiusLG: 8,
    borderRadiusSM: 4,
    controlHeight: 38,
    controlHeightLG: 44,
    controlHeightSM: 30,

    // ── Motion ──────────────────────────────────────────────────────────────────
    motionDurationSlow: '0.3s',
    motionDurationMid: '0.2s',
    motionDurationFast: '0.12s',
  },

  components: {
    // ── Layout ────────────────────────────────────────────────────────────────
    Layout: {
      siderBg: '#080a10',
      headerBg: '#080a10',
      bodyBg: '#06080c',
      footerBg: '#080a10',
    },

    // ── Menu ──────────────────────────────────────────────────────────────────
    Menu: {
      darkItemBg: '#080a10',
      darkSubMenuItemBg: '#080a10',
      darkItemSelectedBg: 'rgba(0,212,255,0.12)',
      darkItemHoverBg: 'rgba(255,255,255,0.05)',
      darkItemColor: '#a8b8d8',
      darkItemSelectedColor: '#00d4ff',
      darkItemHoverColor: '#f0f4fc',
      itemMarginBlock: 4,
      itemMarginInline: 8,
      itemPaddingInline: 16,
    },

    // ── Table ─────────────────────────────────────────────────────────────────
    Table: {
      rowHoverBg: '#141820',
      borderColor: 'rgba(255,255,255,0.06)',
      headerBg: '#141820',
      headerColor: '#a8b8d8',
      bodySortBg: '#0f1218',
      cellPaddingBlock: 14,
      cellPaddingInline: 16,
    },

    // ── Card ──────────────────────────────────────────────────────────────────
    Card: {
      colorBgContainer: '#0f1218',
      colorBorderSecondary: 'rgba(255,255,255,0.06)',
      headerBg: 'transparent',
      headerFontSize: 14,
      headerFontSizeSM: 13,
      paddingLG: 20,
    },

    // ── Button ────────────────────────────────────────────────────────────────
    Button: {
      primaryColor: '#06080c',
      primaryShadow: '0 0 24px rgba(0,212,255,0.28)',
      defaultBg: '#141820',
      defaultBorderColor: 'rgba(255,255,255,0.18)',
      defaultColor: '#f0f4fc',
      defaultHoverBg: '#1a1f2a',
      defaultHoverBorderColor: '#00d4ff',
      defaultHoverColor: '#00d4ff',
      controlHeight: 38,
      controlHeightLG: 44,
      controlHeightSM: 30,
    },

    // ── Input ─────────────────────────────────────────────────────────────────
    Input: {
      colorBgContainer: '#141820',
      colorBorder: 'rgba(255,255,255,0.10)',
      colorText: '#f0f4fc',
      colorTextPlaceholder: '#7888a8',
      activeBorderColor: '#00d4ff',
      activeShadow: '0 0 0 2px rgba(0,212,255,0.15)',
      hoverBorderColor: 'rgba(0,212,255,0.5)',
      paddingBlock: 8,
      paddingInline: 12,
    },

    // ── Select ────────────────────────────────────────────────────────────────
    Select: {
      colorBgContainer: '#141820',
      colorBgElevated: '#1a1f2a',
      colorBorder: 'rgba(255,255,255,0.10)',
      colorText: '#f0f4fc',
      colorTextPlaceholder: '#7888a8',
      optionActiveBg: '#141820',
      optionSelectedBg: 'rgba(0,212,255,0.12)',
      optionSelectedColor: '#00d4ff',
      optionPadding: '10px 14px',
    },

    // ── Tag ───────────────────────────────────────────────────────────────────
    Tag: {
      defaultBg: 'rgba(168,184,216,0.12)',
      defaultColor: '#a8b8d8',
    },

    // ── Alert ─────────────────────────────────────────────────────────────────
    Alert: {
      colorInfoBg: 'rgba(0,212,255,0.08)',
      colorInfoBorder: 'rgba(0,212,255,0.25)',
      colorSuccessBg: 'rgba(0,240,132,0.08)',
      colorSuccessBorder: 'rgba(0,240,132,0.25)',
      colorWarningBg: 'rgba(255,193,69,0.08)',
      colorWarningBorder: 'rgba(255,193,69,0.25)',
      colorErrorBg: 'rgba(255,69,104,0.08)',
      colorErrorBorder: 'rgba(255,69,104,0.25)',
    },

    // ── Progress ──────────────────────────────────────────────────────────────
    Progress: {
      defaultColor: '#00d4ff',
      remainingColor: '#141820',
    },

    // ── Switch ────────────────────────────────────────────────────────────────
    Switch: {
      colorPrimary: '#00d4ff',
      colorPrimaryHover: '#33dcff',
    },

    // ── Pagination ────────────────────────────────────────────────────────────
    Pagination: {
      itemBg: '#141820',
      itemActiveBg: 'rgba(0,212,255,0.12)',
      itemLinkBg: '#141820',
      itemActiveBgDisabled: '#0f1218',
      itemSize: 36,
      itemSizeSM: 28,
    },

    // ── Tooltip ───────────────────────────────────────────────────────────────
    Tooltip: {
      colorBgSpotlight: '#1a1f2a',
      colorTextLightSolid: '#f0f4fc',
    },

    // ── Modal ─────────────────────────────────────────────────────────────────
    Modal: {
      contentBg: '#0f1218',
      headerBg: '#0f1218',
      titleColor: '#f0f4fc',
      titleFontSize: 18,
    },

    // ── Drawer ────────────────────────────────────────────────────────────────
    Drawer: {
      colorBgElevated: '#0f1218',
    },

    // ── Divider ───────────────────────────────────────────────────────────────
    Divider: {
      colorSplit: 'rgba(255,255,255,0.04)',
    },

    // ── Spin ──────────────────────────────────────────────────────────────────
    Spin: {
      colorPrimary: '#00d4ff',
    },

    // ── Statistic ─────────────────────────────────────────────────────────────
    Statistic: {
      titleFontSize: 12,
      contentFontSize: 28,
    },
  },
};

// ─── CSS Variable Exports ─────────────────────────────────────────────────────

import { NODE_TYPE_COLORS } from './nodeTypeColors'
import { EDGE_TYPE_COLORS } from './edgeTypeColors'

/**
 * Export node type colors as CSS custom properties.
 * Can be injected into :root for global access.
 */
export function generateNodeTypeCSS(): string {
  return Object.entries(NODE_TYPE_COLORS)
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
  return Object.entries(EDGE_TYPE_COLORS)
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
    Table: 'magenta',      // Changed from purple
    Event: 'orange',
    Component: 'green',
    Class: 'magenta',      // Changed from purple
    Database: 'magenta',   // Changed from purple
    Cluster: 'blue',
    Infrastructure: 'default',
    Entity: 'magenta',     // Changed from purple
    Field: 'cyan',
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
