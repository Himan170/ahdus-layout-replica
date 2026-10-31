import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/** Where `npm run dev` sends /api in AHDUS mode, unless VITE_AHDUS_API says otherwise. */
const AHDUS_API_DEFAULT = 'http://127.0.0.1:8000';

export default defineConfig(({ mode }) => {
  // .env files and the shell's VITE_* variables
  const env = loadEnv(mode, __dirname, 'VITE_');
  // AHDUS mode (VITE_LAYOUT_BACKEND=ahdus) calls /api/workplace on its own origin, as it
  // does inside AHDUS: in dev that is the AHDUS backend (FastAPI), through this proxy
  const ahdusApi = env.VITE_LAYOUT_BACKEND === 'ahdus' ? env.VITE_AHDUS_API || AHDUS_API_DEFAULT : null;

  return {
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
      proxy: ahdusApi ? { '/api': { target: ahdusApi, changeOrigin: true } } : undefined,
    },
  };
});
