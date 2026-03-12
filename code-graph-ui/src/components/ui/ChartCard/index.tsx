import React from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChartCardProps = {
  title: string
  subtitle?: string
  children: React.ReactNode
  actions?: React.ReactNode
  height?: number | string
}

// ─── ChartCard ────────────────────────────────────────────────────────────────

const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  children,
  actions,
  height = '100%',
}) => {
  return (
    <div
      style={{
        background: 'var(--s-raised)',
        border: '1px solid var(--b-faint)',
        borderRadius: 'var(--radius-m)',
        overflow: 'hidden',
        height,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--b-faint)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--t-secondary)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--t-muted)',
                marginTop: 2,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
        {actions && <div>{actions}</div>}
      </div>

      {/* Content */}
      <div style={{ padding: '20px', flex: 1, overflow: 'auto' }}>
        {children}
      </div>
    </div>
  )
}

export default ChartCard
