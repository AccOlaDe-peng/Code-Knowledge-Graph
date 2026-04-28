import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // 使用正则精确匹配 /repos 或 /repos/ 开头的路径（不匹配 /repository）
      '^/repos(/.*)?$': 'http://localhost:8848',
      '/api': 'http://localhost:8848',
      '/analyze': 'http://localhost:8848',
      '/graph': 'http://localhost:8848',
      '/health': 'http://localhost:8848',
    },
  },
})
