import { defineConfig } from 'vite';

const legacyScriptTag = '<script src="script.js"></script>';
const viteModuleScriptTag = '<script type="module" src="/src/main.js"></script>';

export default defineConfig({
  appType: 'spa',
  plugins: [
    {
      name: 'aure-relics-legacy-entry-bridge',
      transformIndexHtml: {
        // Expose the module entry before Vite discovers and bundles HTML scripts.
        order: 'pre',
        handler(html) {
          return html.replace(legacyScriptTag, viteModuleScriptTag)
            // Raw index.html retains its original offline launch. Vite starts gated.
            .replace('<div id="legacyBoard">', '<div id="legacyBoard" hidden>');
        }
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
