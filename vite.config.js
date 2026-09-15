import { defineConfig } from 'vite';

const legacyScriptTag = '<script src="script.js"></script>';
const viteModuleScriptTag = '<script type="module" src="/src/main.js"></script>';

export default defineConfig({
  appType: 'spa',
  plugins: [
    {
      name: 'aure-relics-legacy-entry-bridge',
      transformIndexHtml(html) {
        return html.replace(legacyScriptTag, viteModuleScriptTag);
      }
    }
  ],
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
