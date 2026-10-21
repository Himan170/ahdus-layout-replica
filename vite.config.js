import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'src/engine'),
      '@': resolve(__dirname, 'src'),
    },
  },
  // Two pages: the app (index.html) and the viewer test page (viewer.html, no Studio code)
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        viewer: resolve(__dirname, 'viewer.html'),
      },
    },
  },
  server: {
    port: 3000,
    // Never move to 3001 when 3000 is busy: localStorage is per port, so the
    // saved layouts would seem to disappear. Stop the other server instead.
    strictPort: true,
    open: true,
  },
});
