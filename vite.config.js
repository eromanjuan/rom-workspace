import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));

// Serve the standalone VESSCORE tabulation app (public/tabulation/index.html)
// for its clean routes in `vite dev`, matching the Vercel rewrites in production.
function tabulationDevServe() {
  const routes = new Set(['/tabulation', '/tabulation/', '/tabulation/master', '/tabulation/judge']);
  return {
    name: 'tabulation-dev-serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0];
        if (routes.has(path)) {
          try {
            const html = readFileSync(join(rootDir, 'public', 'tabulation', 'index.html'), 'utf-8');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
            return;
          } catch { /* fall through to default handling */ }
        }
        next();
      });
    },
  };
}

// ROM is a plain Vite single-page app. `dist/` is what Firebase Hosting / Vercel serve.
export default defineConfig({
  plugins: [tabulationDevServe()],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
});
