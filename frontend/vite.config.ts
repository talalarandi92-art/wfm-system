import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      // Dev proxy → our WFM backend. Set VITE_API_PORT to switch (defaults 3001
      // so the dev frontend uses OUR backend, not the old Enterprise-Lab on 3000).
      '/api': {
        target: `http://localhost:${process.env.VITE_API_PORT ?? 3001}`,
        changeOrigin: true,
      },
      '/uploads': {
        target: `http://localhost:${process.env.VITE_API_PORT ?? 3001}`,
        changeOrigin: true,
      },
    },
  },
});
