import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/** Where `npm run dev` sends /api in AHDUS mode, unless VITE_AHDUS_API says otherwise. */
const AHDUS_API_DEFAULT = 'http://127.0.0.1:8000';

export default defineConfig(({ mode }) => {
  // .env files and the shell's VITE_* variables
  const env = loadEnv(mode, __dirname, 'VITE_');
  // Load server-side secrets (including OPENROUTER_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY)
  const serverEnv = loadEnv(mode, __dirname, '');
  const apiConfig = {
    openrouterApiKey: serverEnv.OPENROUTER_API_KEY || '',
    geminiApiKey: serverEnv.GEMINI_API_KEY || '',
    groqApiKey: serverEnv.GROQ_API_KEY || '',
    openaiApiKey: serverEnv.OPENAI_API_KEY || '',
  };

  // AHDUS mode (VITE_LAYOUT_BACKEND=ahdus) calls /api/workplace on its own origin, as it
  // does inside AHDUS: in dev that is the AHDUS backend (FastAPI), through this proxy
  const ahdusApi = env.VITE_LAYOUT_BACKEND === 'ahdus' ? env.VITE_AHDUS_API || AHDUS_API_DEFAULT : null;

  const aiReconstructionPlugin = {
    name: 'ai-reconstruction-endpoint',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/api/ai/reconstruct' && req.method === 'POST') {
          let raw = '';
          req.on('data', (chunk) => { raw += chunk; });
          req.on('end', async () => {
            try {
              const body = JSON.parse(raw || '{}');
              const { handleReconstructionRequest } = await import('./src/services/aiReconstructionHandler.js');
              const result = await handleReconstructionRequest(body, apiConfig);
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = result.ok ? 200 : (result.status || 500);
              res.end(JSON.stringify(result));
            } catch (err) {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, error: err.message || 'Internal reconstruction error' }));
            }
          });
        } else {
          next();
        }
      });
    },
  };

  return {
    plugins: [react(), aiReconstructionPlugin],
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
