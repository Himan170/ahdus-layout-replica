// The embed: one file for plain HTML pages (no React, no build step on their side).
//   npm run build:embed  →  dist-embed/ahdus-workplace.js   (global AHDUSWorkplace, React + Babylon inside)
//                           dist-embed/ahdus-workplace.css  (the same rules the script adds itself)
// docs/EMBED_GUIDE.md; e2e/embed-smoke.mjs checks it has no Workplace Studio code.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

export default defineConfig({
  plugins: [
    react(),
    {
      // The script injects its stylesheet itself (embed.css?inline); this copy is
      // for pages whose Content-Security-Policy blocks injected styles
      name: 'ahdus-embed-css',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'ahdus-workplace.css',
          source: readFileSync(resolve(__dirname, 'src/embed/embed.css'), 'utf8'),
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'src/engine'),
      '@': resolve(__dirname, 'src'),
    },
  },
  // Library builds keep process.env for the user's bundler; a plain page has none (React reads it)
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  publicDir: false,
  build: {
    outDir: 'dist-embed',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/embed/index.jsx'),
      name: 'AHDUSWorkplace',
      formats: ['iife'],
      fileName: () => 'ahdus-workplace.js',
    },
    rollupOptions: {
      output: {
        banner: `/*! AHDUS Workplace embed · ahdus-layout-replica ${commit} · built ${new Date().toISOString().slice(0, 10)} · docs/EMBED_GUIDE.md */`,
      },
    },
  },
});
