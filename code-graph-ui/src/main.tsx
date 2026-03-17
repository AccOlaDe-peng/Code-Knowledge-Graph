import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles/global.css';

// 清理旧的 localStorage 数据（仓库列表现在从后端同步）
localStorage.removeItem('repo-store-v2');
localStorage.removeItem('repo-store');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
