import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 8118,
    proxy: {
      '/repos': 'http://localhost:8848',
      '/api': 'http://localhost:8848',
      '/analyze': 'http://localhost:8848',
      '/graph': 'http://localhost:8848',
      '/health': 'http://localhost:8848',
    },
  },
})
