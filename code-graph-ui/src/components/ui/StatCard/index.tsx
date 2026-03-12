import React from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type StatCardProps = {
  icon: string
  label: string
  value: number | string
  color: string
  trend?: string
  onClick?: () => void
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

const StatCard: React.FC<StatCardProps> = ({
  icon,
  label,
  value,
  color,
  trend,
  onClick,
}) => {
  const formattedValue =
    typeof value === 'number' ? value.toLocaleString() : value

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--s-raised)',
        border: '1px solid var(--b-faint)',
        borderTop: `2px solid ${color}`,
        borderRadius: 'var(--radius-m)',
        padding: '18px 20px',
        position: 'relative',
        overflow: 'hidden',
        flex: 1,
        minWidth: 140,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s',
      }}
      onMouseEnter={e => {
        if (onClick) {
          e.currentTarget.style.borderTopColor = color
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = `0 8px 24px ${color}22`
        }
      }}
      onMouseLeave={e => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = 'none'
        }
      }}
    >
      {/* Glow effect */}
      <div
        style={{
          position: 'absolute',
          top: -30,
          right: -30,
          width: 100,
          height: 100,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color}15 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 20, marginBottom: 10, lineHeight: 1 }}>
          {icon}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 28,
            fontWeight: 600,
            color: 'var(--t-primary)',
            lineHeight: 1,
            letterSpacing: '-0.02em',
            marginBottom: 6,
          }}
        >
          {formattedValue}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: 'var(--t-muted)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </div>
        {trend && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color,
              marginTop: 4,
            }}
          >
            {trend}
          </div>
        )}
      </div>
    </div>
  )
}

export default StatCard
