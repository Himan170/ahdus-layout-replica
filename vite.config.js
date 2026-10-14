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
  server: {
    port: 3000,
    // Never move to 3001 when 3000 is busy: localStorage is per port, so the
    // saved layouts would seem to disappear. Stop the other server instead.
    strictPort: true,
    open: true,
  },
});
