import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default defineConfig({
  ...viteConfig,
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/ahdus-layout-replica-backup/**',
    ],
  },
});
