import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = 'http://localhost:4747';

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: { '/api': target, '/media': target, '/oauth': target },
  },
  preview: {
    port: 4173,
    proxy: { '/api': target, '/media': target, '/oauth': target },
  },
});
