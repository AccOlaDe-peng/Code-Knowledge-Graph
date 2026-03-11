import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface NavItem {
  path: string;
  icon: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/',              icon: '◈', label: 'OVERVIEW'     },
  { path: '/repository',   icon: '⬡', label: 'REPOSITORY'   },
  { path: '/architecture', icon: '⌥', label: 'ARCHITECTURE' },
  { path: '/callgraph',    icon: '⇢', label: 'CALL GRAPH'   },
  { path: '/lineage',      icon: '⊞', label: 'DATA LINEAGE' },
  { path: '/eventflow',    icon: '⚡', label: 'EVENT FLOW'   },
  { path: '/query',        icon: '✦', label: 'AI QUERY'     },
  { path: '/impact',       icon: '◎', label: 'IMPACT'       },
];

const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate  = useNavigate();
  const location  = useLocation();
  const w = collapsed ? 64 : 244;

  return (
    <aside style={{
      position: 'fixed', left: 0, top: 0, bottom: 0, width: w, zIndex: 200,
      background: '#0a0d13',
      borderRight: '1px solid rgba(255,255,255,0.05)',
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
      overflow: 'hidden',
    }}>

      {/* Logo */}
      <div
        onClick={() => navigate('/')}
        style={{
          height: 54, minHeight: 54, display: 'flex', alignItems: 'center',
          padding: collapsed ? '0 0 0 18px' : '0 20px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          gap: 12, cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{
          width: 28, height: 28, minWidth: 28,
          border: '1.5px solid #00d4ff', borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, color: '#00d4ff', fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          boxShadow: '0 0 12px rgba(0,212,255,0.28)',
          flexShrink: 0,
        }}>KG</span>
        {!collapsed && (
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#d0d5e8', letterSpacing: '0.06em', lineHeight: 1.25, fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap' }}>
              CODE GRAPH
            </div>
            <div style={{ fontSize: 9, color: 'var(--t-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', whiteSpace: 'nowrap', marginTop: 1 }}>
              KNOWLEDGE SYSTEM
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto', overflowX: 'hidden' }}>
        {NAV_ITEMS.map((item) => {
          const active = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);
          return (
            <div
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                height: 40, display: 'flex', alignItems: 'center',
                padding: collapsed ? '0 0 0 20px' : '0 20px',
                gap: 12, cursor: 'pointer', position: 'relative',
                color: active ? '#00d4ff' : '#6e7a99',
                background: active ? 'rgba(0,212,255,0.07)' : 'transparent',
                borderLeft: active ? '2px solid #00d4ff' : '2px solid transparent',
                transition: 'background 0.12s, color 0.12s',
              }}
              onMouseEnter={e => { if (!active) { const el = e.currentTarget as HTMLDivElement; el.style.background='rgba(255,255,255,0.03)'; el.style.color='#9ba6c0'; }}}
              onMouseLeave={e => { if (!active) { const el = e.currentTarget as HTMLDivElement; el.style.background='transparent'; el.style.color='#6e7a99'; }}}
            >
              {active && (
                <span style={{
                  position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                  width: 2, height: '55%', background: '#00d4ff',
                  boxShadow: '2px 0 10px rgba(0,212,255,0.7)', borderRadius: '0 2px 2px 0',
                }} />
              )}
              <span style={{
                fontSize: 15, lineHeight: 1, width: 20, textAlign: 'center', flexShrink: 0,
                filter: active ? 'drop-shadow(0 0 5px rgba(0,212,255,0.7))' : 'none',
              }}>{item.icon}</span>
              {!collapsed && (
                <span style={{
                  fontSize: 11, fontFamily: 'var(--font-mono)',
                  fontWeight: active ? 500 : 400, letterSpacing: '0.1em', whiteSpace: 'nowrap',
                }}>{item.label}</span>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{
        padding: collapsed ? '12px 0 12px 18px' : '10px 18px',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
      }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#00f084', boxShadow: '0 0 6px rgba(0,240,132,0.6)',
              display: 'inline-block', flexShrink: 0,
            }} />
            <span style={{ fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>
              API CONNECTED
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: 'none', border: '1px solid rgba(255,255,255,0.08)',
            cursor: 'pointer', color: 'var(--t-muted)',
            fontSize: 16, padding: '2px 8px', borderRadius: 3,
            fontFamily: 'var(--font-mono)', lineHeight: 1.4,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.target as HTMLElement).style.color='#00d4ff'; (e.target as HTMLElement).style.borderColor='rgba(0,212,255,0.3)'; }}
          onMouseLeave={e => { (e.target as HTMLElement).style.color='var(--t-muted)'; (e.target as HTMLElement).style.borderColor='rgba(255,255,255,0.08)'; }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
