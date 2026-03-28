import React from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type SkeletonProps = {
  width?: string | number
  height?: string | number
  borderRadius?: number | string
  style?: React.CSSProperties
  className?: string
}

type SkeletonCardProps = {
  showIcon?: boolean
  lines?: number
  style?: React.CSSProperties
}

type SkeletonTableProps = {
  rows?: number
  columns?: number
}

type SkeletonGraphProps = {
  width?: string | number
  height?: string | number
}

type SkeletonListProps = {
  count?: number
}

// ─── Base Skeleton ────────────────────────────────────────────────────────────

const shimmerStyle: React.CSSProperties = {
  background: `linear-gradient(
    90deg,
    var(--s-float) 0%,
    var(--s-overlay) 50%,
    var(--s-float) 100%
  )`,
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.5s ease-in-out infinite',
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius = 4,
  style,
  className,
}) => (
  <div
    className={className}
    style={{
      width: typeof width === 'number' ? `${width}px` : width,
      height: typeof height === 'number' ? `${height}px` : height,
      borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
      ...shimmerStyle,
      ...style,
    }}
  />
)

// ─── Stat Card Skeleton ───────────────────────────────────────────────────────

export const SkeletonStatCard: React.FC<SkeletonCardProps> = ({
  showIcon = true,
  lines = 2,
  style,
}) => (
  <div
    style={{
      background: 'var(--s-raised)',
      border: '1px solid var(--b-faint)',
      borderRadius: 'var(--radius-m)',
      padding: 24,
      position: 'relative',
      overflow: 'hidden',
      flex: 1,
      minWidth: 160,
      ...style,
    }}
  >
    {showIcon && (
      <Skeleton width={32} height={32} borderRadius={6} style={{ marginBottom: 16 }} />
    )}
    <Skeleton width="60%" height={36} borderRadius={4} style={{ marginBottom: 8 }} />
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton
        key={i}
        width={i === 0 ? '80%' : '50%'}
        height={14}
        borderRadius={3}
        style={{ marginTop: 6 }}
      />
    ))}
  </div>
)

// ─── Table Skeleton ───────────────────────────────────────────────────────────

export const SkeletonTable: React.FC<SkeletonTableProps> = ({
  rows = 5,
  columns = 4,
}) => (
  <div style={{ width: '100%' }}>
    {/* Header */}
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: 16,
        padding: '14px 24px',
        background: 'var(--s-float)',
        borderBottom: '1px solid var(--b-faint)',
      }}
    >
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} width="60%" height={12} borderRadius={2} />
      ))}
    </div>
    {/* Rows */}
    {Array.from({ length: rows }).map((_, rowIndex) => (
      <div
        key={rowIndex}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 16,
          padding: '16px 24px',
          borderBottom: '1px solid var(--b-faint)',
        }}
      >
        {Array.from({ length: columns }).map((_, colIndex) => (
          <Skeleton
            key={colIndex}
            width={colIndex === 0 ? '80%' : '50%'}
            height={14}
            borderRadius={3}
          />
        ))}
      </div>
    ))}
  </div>
)

// ─── Graph Skeleton ───────────────────────────────────────────────────────────

export const SkeletonGraph: React.FC<SkeletonGraphProps> = ({
  width = '100%',
  height = 400,
}) => {
  const actualHeight = typeof height === 'number' ? height : parseInt(height as string, 10) || 400
  const actualWidth = typeof width === 'number' ? width : '100%'

  // Pre-defined node positions for visual effect (avoiding Math.random in render)
  const nodes = [
    { x: 50, y: 80, id: 0 },
    { x: 250, y: 95, id: 1 },
    { x: 430, y: 85, id: 2 },
    { x: 630, y: 100, id: 3 },
    { x: 80, y: 200, id: 4 },
    { x: 260, y: 215, id: 5 },
    { x: 450, y: 195, id: 6 },
    { x: 620, y: 210, id: 7 },
    { x: 60, y: 320, id: 8 },
    { x: 240, y: 335, id: 9 },
    { x: 470, y: 310, id: 10 },
    { x: 650, y: 340, id: 11 },
  ]

  return (
    <div
      style={{
        width: actualWidth,
        height: actualHeight,
        background: 'var(--s-void)',
        borderRadius: 'var(--radius-m)',
        border: '1px solid var(--b-faint)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative node placeholders */}
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', opacity: 0.3 }}
      >
        {nodes.map((node, i) => {
          const nextNode = nodes[i + 1]
          return (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={60}
                height={30}
                rx={4}
                fill="var(--s-float)"
              />
              {nextNode && i < nodes.length - 1 && i % 4 !== 3 && (
                <line
                  x1={node.x + 60}
                  y1={node.y + 15}
                  x2={nextNode.x}
                  y2={nextNode.y + 15}
                  stroke="var(--b-subtle)"
                  strokeWidth={1}
                />
              )}
            </g>
          )
        })}
      </svg>

      {/* Shimmer overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          ...shimmerStyle,
          opacity: 0.5,
        }}
      />
    </div>
  )
}

// ─── List Skeleton ────────────────────────────────────────────────────────────

export const SkeletonList: React.FC<SkeletonListProps> = ({ count = 5 }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '14px 18px',
          background: 'var(--s-float)',
          border: '1px solid var(--b-faint)',
          borderRadius: 6,
        }}
      >
        <Skeleton width={10} height={10} borderRadius="50%" />
        <div style={{ flex: 1 }}>
          <Skeleton width="60%" height={14} borderRadius={3} style={{ marginBottom: 6 }} />
          <Skeleton width="40%" height={10} borderRadius={2} />
        </div>
        <Skeleton width={60} height={24} borderRadius={4} />
      </div>
    ))}
  </div>
)

// ─── Stats Grid Skeleton ──────────────────────────────────────────────────────

export const SkeletonStatsGrid: React.FC<{ count?: number }> = ({ count = 5 }) => (
  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonStatCard key={i} />
    ))}
  </div>
)

// ─── Card Skeleton ────────────────────────────────────────────────────────────

export const SkeletonCard: React.FC<{ height?: number }> = ({ height = 200 }) => (
  <div
    style={{
      background: 'var(--s-raised)',
      border: '1px solid var(--b-faint)',
      borderRadius: 'var(--radius-m)',
      padding: 24,
      height,
      position: 'relative',
      overflow: 'hidden',
    }}
  >
    <Skeleton width="40%" height={14} borderRadius={3} style={{ marginBottom: 16 }} />
    <Skeleton width="100%" height={20} borderRadius={4} style={{ marginBottom: 12 }} />
    <Skeleton width="80%" height={16} borderRadius={3} style={{ marginBottom: 8 }} />
    <Skeleton width="60%" height={16} borderRadius={3} />
  </div>
)

export default Skeleton
