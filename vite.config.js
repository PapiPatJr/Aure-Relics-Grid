import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'spa',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    open: false
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: false,
    open: false
  }
});
