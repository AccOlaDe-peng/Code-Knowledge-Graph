import React from 'react';
import { useGraphStore } from '../../store/graphStore';

interface Feature { label: string; desc: string; }

interface ComingSoonProps {
  breadcrumb: string;
  title: string;
  icon: string;
  accent: string;
  renderer: string;
  description: string;
  features: Feature[];
  edgeTypes?: string[];
}

const ComingSoon: React.FC<ComingSoonProps> = ({
  breadcrumb, title, icon, accent, renderer,
  description, features, edgeTypes,
}) => {
  const { activeGraphId } = useGraphStore();
  const accentRgb = accent === '#00d4ff' ? '0,212,255'
    : accent === '#00f084' ? '0,240,132'
    : accent === '#b08eff' ? '176,142,255'
    : accent === '#ffc145' ? '255,193,69'
    : '255,69,104';

  return (
    <div>
      {/* Heading */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.15em', marginBottom: 4 }}>
          SYS / {breadcrumb}
        </div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--t-primary)', fontFamily: 'var(--font-ui)' }}>
          {title}
        </h2>
      </div>

      {/* No repo warning */}
      {!activeGraphId && (
        <div style={{
          background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.15)',
          borderRadius: 'var(--radius-m)', padding: '12px 18px',
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20,
        }}>
          <span style={{ color: 'var(--a-cyan)', fontSize: 14, flexShrink: 0 }}>ℹ</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--t-secondary)' }}>
            请从顶栏选择一个仓库以解锁此视图
          </span>
        </div>
      )}

      {/* Main card */}
      <div style={{
        background: 'var(--s-raised)', border: `1px solid var(--b-faint)`,
        borderTop: `2px solid ${accent}`, borderRadius: 'var(--radius-m)',
        overflow: 'hidden', position: 'relative',
      }}>
        {/* BG glow */}
        <div style={{
          position: 'absolute', top: 0, right: 0, width: 300, height: 300,
          background: `radial-gradient(circle at top right, rgba(${accentRgb},0.06) 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        {/* Preview area */}
        <div style={{
          height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderBottom: '1px solid var(--b-faint)', position: 'relative', overflow: 'hidden',
        }}>
          {/* Decorative node graph */}
          <svg width="380" height="180" viewBox="0 0 380 180" style={{ opacity: 0.15, position: 'absolute' }}>
            {[[60,90],[140,40],[140,140],[240,70],[240,120],[320,90]].map(([cx,cy], i) => (
              <circle key={i} cx={cx} cy={cy} r={6} fill={accent} />
            ))}
            {[[60,90,140,40],[60,90,140,140],[140,40,240,70],[140,140,240,120],[240,70,320,90],[240,120,320,90],[140,40,240,120]].map(([x1,y1,x2,y2],i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={accent} strokeWidth={1.5} />
            ))}
          </svg>
          <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
            <div style={{ fontSize: 48, marginBottom: 10, filter: `drop-shadow(0 0 12px rgba(${accentRgb},0.5))` }}>{icon}</div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 14px',
              background: `rgba(${accentRgb},0.1)`, border: `1px solid rgba(${accentRgb},0.25)`,
              borderRadius: 3,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, display: 'inline-block', opacity: 0.7 }} />
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: accent, letterSpacing: '0.1em' }}>
                即将推出 · {renderer}
              </span>
            </div>
          </div>
        </div>

        {/* Description + features */}
        <div style={{ padding: '22px 24px', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <p style={{ margin: '0 0 20px', fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--t-secondary)', lineHeight: 1.7 }}>
              {description}
            </p>
            {edgeTypes && (
              <div>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                  边类型
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {edgeTypes.map(e => (
                    <span key={e} style={{
                      padding: '2px 8px', borderRadius: 3, fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      background: `rgba(${accentRgb},0.08)`, border: `1px solid rgba(${accentRgb},0.2)`,
                      color: accent,
                    }}>{e}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {features.map(f => (
              <div key={f.label} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ color: accent, fontSize: 14, marginTop: 1, flexShrink: 0, filter: `drop-shadow(0 0 4px rgba(${accentRgb},0.5))` }}>◈</span>
                <div>
                  <div style={{ fontSize: 12, fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--t-primary)', marginBottom: 2 }}>{f.label}</div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)' }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComingSoon;
