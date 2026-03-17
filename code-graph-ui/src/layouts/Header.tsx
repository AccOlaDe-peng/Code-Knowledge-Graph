import React from 'react';

const Header: React.FC = () => {
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 100, height: 54,
      background: '#0a0d13',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      display: 'flex', alignItems: 'center',
      padding: '0 24px',
      justifyContent: 'flex-end',
      gap: 16,
    }}>
      {/* 可以在这里添加其他全局操作按钮 */}
    </header>
  );
};

export default Header;
