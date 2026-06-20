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
      // Dev proxy → our WFM backend on :3000 (Enterprise Lab retired). Override
      // with VITE_API_PORT if the backend runs on a different port.
      '/api': {
        target: `http://localhost:${process.env.VITE_API_PORT ?? 3000}`,
        changeOrigin: true,
      },
      '/uploads': {
        target: `http://localhost:${process.env.VITE_API_PORT ?? 3000}`,
        changeOrigin: true,
      },
    },
  },
});
