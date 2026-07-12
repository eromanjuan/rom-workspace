import { defineConfig } from 'vite';

// ROM is a plain Vite single-page app. `dist/` is what Firebase Hosting serves.
export default defineConfig({
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
});
