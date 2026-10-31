// Workplace Studio for AHDUS (npm run build:ahdus, scripts/build-ahdus.mjs):
// the app (index.html only, not the viewer test page) served at /workplace-studio/ by the
// AHDUS server, saving through the AHDUS API (VITE_LAYOUT_BACKEND=ahdus, set by the script).
// Every asset URL (scripts, models, textures, sky.env) starts with the base:
// realLook.js builds its paths from import.meta.env.BASE_URL.
import { defineConfig } from 'vite';
import { resolve } from 'path';
import appConfig from './vite.config.js';

export const AHDUS_STUDIO_BASE = '/workplace-studio/';

export default defineConfig((env) => {
  const app = appConfig(env);
  return {
    plugins: app.plugins,
    resolve: app.resolve,
    base: AHDUS_STUDIO_BASE,
    build: {
      outDir: 'dist-ahdus/workplace-studio',
      emptyOutDir: true,
      rollupOptions: {
        input: { main: resolve(__dirname, 'index.html') },
      },
    },
  };
});
