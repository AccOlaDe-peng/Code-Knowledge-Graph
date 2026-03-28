import React from 'react'
import { useRipple, getRippleStyle, usePress } from '../../../core/hooks/useInteraction'
import type { Ripple } from '../../../core/hooks/useInteraction'

// ─── Types ────────────────────────────────────────────────────────────────────

export type StatCardProps = {
  icon: React.ReactNode | string
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
  const { ref, ripples, createRipple } = useRipple<HTMLDivElement>()
  const { isPressed, handlers } = usePress()
  const formattedValue =
    typeof value === 'number' ? value.toLocaleString() : value

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (onClick) {
      createRipple(e)
      onClick()
    }
  }

  return (
    <div
      ref={ref}
      onClick={handleClick}
      {...(onClick ? handlers : {})}
      style={{
        background: 'linear-gradient(135deg, var(--s-raised) 0%, rgba(15,18,24,0.8) 100%)',
        border: '1px solid var(--b-faint)',
        borderTop: `3px solid ${color}`,
        borderRadius: 'var(--radius-m)',
        padding: '24px 24px',
        position: 'relative',
        overflow: 'hidden',
        flex: 1,
        minWidth: 160,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'var(--transition-normal)',
        transform: isPressed ? 'scale(0.98)' : 'translateY(0)',
      }}
      onMouseEnter={(e) => {
        if (onClick && !isPressed) {
          e.currentTarget.style.borderTopColor = color
          e.currentTarget.style.transform = 'translateY(-3px)'
          e.currentTarget.style.boxShadow = `0 12px 32px ${color}18`
        }
      }}
      onMouseLeave={(e) => {
        if (onClick && !isPressed) {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = 'none'
        }
      }}
    >
      {/* Ripple effects */}
      {ripples.map((ripple: Ripple) => (
        <span key={ripple.id} style={getRippleStyle(ripple, `${color}20`)} />
      ))}

      {/* Glow effect */}
      <div
        style={{
          position: 'absolute',
          top: -40,
          right: -40,
          width: 120,
          height: 120,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color}12 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div
          style={{
            fontSize: typeof icon === 'string' ? 26 : undefined,
            marginBottom: 12,
            lineHeight: 1,
            filter: `drop-shadow(0 0 8px ${color}40)`,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {typeof icon === 'string' ? icon : icon}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 36,
            fontWeight: 600,
            color: 'var(--t-primary)',
            lineHeight: 1,
            letterSpacing: '-0.02em',
            marginBottom: 8,
          }}
        >
          {formattedValue}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--t-secondary)',
            letterSpacing: '0.01em',
          }}
        >
          {label}
        </div>
        {trend && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color,
              marginTop: 8,
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
