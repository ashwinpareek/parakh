import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Serves api/ai.js during `npm run dev` / `npm run preview`, so the hosted-AI path can be tested
// locally with a key in .env.local (GEMINI_API_KEY=... or ANTHROPIC_API_KEY=...).
function localApi(env: Record<string, string>): Plugin {
  const mount = (server: { middlewares: { use: (path: string, fn: (req: any, res: any) => void) => void } }) => {
    server.middlewares.use('/api/ai', async (req, res) => {
      Object.assign(process.env, env);
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = undefined; }
      req.query = Object.fromEntries(new URL(req.originalUrl ?? req.url ?? '/', 'http://x').searchParams);
      const shim = {
        status(code: number) { res.statusCode = code; return shim; },
        setHeader(k: string, v: string) { res.setHeader(k, v); return shim; },
        json(v: unknown) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)); },
      };
      const mod = await import(/* @vite-ignore */ new URL('./api/ai.js', import.meta.url).href);
      await mod.default(req, shim);
    });
  };
  return { name: 'parakh-local-api', configureServer: mount, configurePreviewServer: mount };
}

// `npm run build` produces a regular multi-file build in dist/ (deploy to Vercel; api/ becomes a function).
// `npm run build:single` inlines everything into one HTML file (used for the claude.ai demo).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const keys = Object.fromEntries(Object.entries(env).filter(([k]) => ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_MODEL'].includes(k)));
  return {
    base: './',
    plugins: [react(), localApi(keys), ...(mode === 'single' ? [viteSingleFile()] : [])],
    build: { outDir: mode === 'single' ? 'dist-single' : 'dist', chunkSizeWarningLimit: 4000 },
  };
});
