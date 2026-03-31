import React from 'react'

// ─── Icon Types ────────────────────────────────────────────────────────────────

type IconProps = {
  size?: number
  color?: string
  className?: string
  style?: React.CSSProperties
}

// ─── Icon Wrapper ─────────────────────────────────────────────────────────────

const IconWrapper: React.FC<IconProps & { children: React.ReactNode }> = ({
  size = 20,
  color = 'currentColor',
  children,
  style,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
  >
    {children}
  </svg>
)

// ─── Navigation Icons ────────────────────────────────────────────────────────

export const IconDashboard: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <rect x={3} y={3} width={7} height={7} rx={1} />
    <rect x={14} y={3} width={7} height={7} rx={1} />
    <rect x={3} y={14} width={7} height={7} rx={1} />
    <rect x={14} y={14} width={7} height={7} rx={1} />
  </IconWrapper>
)

export const IconRepository: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <path d="M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6z" />
    <path d="M3 9h18" />
    <path d="M9 3v18" />
  </IconWrapper>
)

export const IconArchitecture: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
    <line x1="12" y1="22" x2="12" y2="15.5" />
    <polyline points="22 8.5 12 15.5 2 8.5" />
    <polyline points="2 15.5 12 8.5 22 15.5" />
    <line x1="12" y1="2" x2="12" y2="8.5" />
  </IconWrapper>
)

export const IconDataLineage: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <path d="M4 4h6v6H4z" />
    <path d="M14 4h6v6h-6z" />
    <path d="M4 14h6v6H4z" />
    <path d="M17 14v6" />
    <path d="M14 17h6" />
    <path d="M10 7h4" />
    <path d="M7 10v4" />
  </IconWrapper>
)

export const IconEventFlow: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </IconWrapper>
)

export const IconQuery: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <circle cx={11} cy={11} r={8} />
    <path d="M21 21l-4.35-4.35" />
    <path d="M11 8v6" />
    <path d="M8 11h6" />
  </IconWrapper>
)

export const IconFieldLineage: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <path d="M4 12h4" />
    <path d="M16 12h4" />
    <circle cx={9} cy={12} r={2} />
    <circle cx={15} cy={12} r={2} />
    <path d="M11 12h2" />
    <path d="M9 10v-2" />
    <path d="M15 10v-2" />
    <path d="M9 14v2" />
    <path d="M15 14v2" />
  </IconWrapper>
)

// ─── Node Type Icons ─────────────────────────────────────────────────────────

export const IconModule: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <rect x={3} y={3} width={18} height={18} rx={2} />
    <path d="M3 9h18" />
    <path d="M9 21V9" />
  </IconWrapper>
)

export const IconFunction: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M9 12h6" />
    <path d="M9 16h3" />
  </IconWrapper>
)

export const IconAPI: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </IconWrapper>
)

export const IconDatabase: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <ellipse cx={12} cy={5} rx={9} ry={3} />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </IconWrapper>
)

export const IconEvent: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </IconWrapper>
)

export const IconClass: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <rect x={3} y={3} width={18} height={18} rx={2} />
    <path d="M8 8h8" />
    <path d="M8 12h8" />
    <path d="M8 16h4" />
  </IconWrapper>
)

export const IconService: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <circle cx={12} cy={12} r={3} />
    <path d="M12 1v4" />
    <path d="M12 19v4" />
    <path d="M1 12h4" />
    <path d="M19 12h4" />
    <path d="M4.22 4.22l2.83 2.83" />
    <path d="M16.95 16.95l2.83 2.83" />
    <path d="M4.22 19.78l2.83-2.83" />
    <path d="M16.95 7.05l2.83-2.83" />
  </IconWrapper>
)

export const IconComponent: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </IconWrapper>
)

export const IconTable: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <rect x={3} y={3} width={18} height={18} rx={2} />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
    <path d="M9 3v18" />
  </IconWrapper>
)

export const IconTopic: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
    <path d="M12 12v9" />
    <path d="M8 17h8" />
  </IconWrapper>
)

export const IconCluster: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <circle cx={6} cy={6} r={3} />
    <circle cx={18} cy={6} r={3} />
    <circle cx={6} cy={18} r={3} />
    <circle cx={18} cy={18} r={3} />
    <path d="M9 6h6" />
    <path d="M6 9v6" />
    <path d="M18 9v6" />
    <path d="M9 18h6" />
  </IconWrapper>
)

// ─── Action Icons ────────────────────────────────────────────────────────────

export const IconCollapse: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <polyline points="11 17 6 12 11 7" />
    <polyline points="18 17 13 12 18 7" />
  </IconWrapper>
)

export const IconExpand: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <polyline points="13 17 18 12 13 7" />
    <polyline points="6 17 11 12 6 7" />
  </IconWrapper>
)

export const IconConnect: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <circle cx={6} cy={12} r={3} />
    <circle cx={18} cy={12} r={3} />
    <line x1="9" y1="12" x2="15" y2="12" />
  </IconWrapper>
)

export const IconZoomIn: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <circle cx={11} cy={11} r={8} />
    <path d="M21 21l-4.35-4.35" />
    <path d="M11 8v6" />
    <path d="M8 11h6" />
  </IconWrapper>
)

export const IconZoomOut: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <circle cx={11} cy={11} r={8} />
    <path d="M21 21l-4.35-4.35" />
    <path d="M8 11h6" />
  </IconWrapper>
)

export const IconRefresh: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </IconWrapper>
)

export const IconFilter: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </IconWrapper>
)

export const IconDownload: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </IconWrapper>
)

export const IconUpload: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </IconWrapper>
)

export const IconSettings: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <circle cx={12} cy={12} r={3} />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </IconWrapper>
)

export const IconClose: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </IconWrapper>
)

export const IconCheck: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <polyline points="20 6 9 17 4 12" />
  </IconWrapper>
)

export const IconPlus: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </IconWrapper>
)

export const IconMinus: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <line x1="5" y1="12" x2="19" y2="12" />
  </IconWrapper>
)

export const IconEdit: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </IconWrapper>
)

export const IconTrash: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </IconWrapper>
)

export const IconCopy: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <rect x={9} y={9} width={13} height={13} rx={2} ry={2} />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </IconWrapper>
)

// ─── Layout Icons ────────────────────────────────────────────────────────────

export const IconLayoutGrid: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <rect x={3} y={3} width={7} height={7} rx={1} />
    <rect x={14} y={3} width={7} height={7} rx={1} />
    <rect x={3} y={14} width={7} height={7} rx={1} />
    <rect x={14} y={14} width={7} height={7} rx={1} />
  </IconWrapper>
)

export const IconLayoutDagre: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <circle cx={12} cy={5} r={2} />
    <circle cx={6} cy={12} r={2} />
    <circle cx={18} cy={12} r={2} />
    <circle cx={12} cy={19} r={2} />
    <path d="M12 7v10" />
    <path d="M12 7L6 10" />
    <path d="M12 7l6 3" />
    <path d="M12 17l-6-3" />
    <path d="M12 17l6-3" />
  </IconWrapper>
)

export const IconLayoutForce: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <circle cx={12} cy={12} r={3} />
    <circle cx={5} cy={8} r={2} />
    <circle cx={19} cy={8} r={2} />
    <circle cx={5} cy={16} r={2} />
    <circle cx={19} cy={16} r={2} />
    <path d="M7 9l2 2" />
    <path d="M17 9l-2 2" />
    <path d="M7 15l2-2" />
    <path d="M17 15l-2-2" />
  </IconWrapper>
)

// ─── Status Icons ────────────────────────────────────────────────────────────

export const IconLoading: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </IconWrapper>
)

export const IconSuccess: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <circle cx={12} cy={12} r={10} />
    <polyline points="16 10 10 16 8 14" />
  </IconWrapper>
)

export const IconWarning: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </IconWrapper>
)

export const IconError: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <circle cx={12} cy={12} r={10} />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </IconWrapper>
)

export const IconInfo: React.FC<IconProps> = (props) => (
  <IconWrapper {...props}>
    <circle cx={12} cy={12} r={10} />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </IconWrapper>
)

// Re-export types
export type { IconProps }

