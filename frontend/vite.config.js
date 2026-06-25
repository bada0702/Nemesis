import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: 5174,
    allowedHosts: ['chojungwon.iptime.org'],
    proxy: {
      '/api': {
        target: 'http://localhost:18080',
        changeOrigin: true,
      },
    },
  },
})
