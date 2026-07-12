import { defineConfig } from 'vite';

// Embedded ROM Workspace module.
// Builds src/main.js into ../public/workspace-module so ROM (the parent Vite
// app) serves it statically at /workspace-module/. index.html, rom-fb-bridge.js
// and rom-embed.css live in ./public and are copied verbatim.
//
// Output names are STABLE (no content hash) so the bridge + index.html never
// need per-build rewiring. Cache-busting is done with the ?v= query the bridge
// and index.html carry — bump those when the module code changes.
export default defineConfig({
  base: '/workspace-module/',
  define: {
    __QUEST_BUILD_SHA__: JSON.stringify('embedded'),
  },
  build: {
    outDir: '../public/workspace-module',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      // src/main.js is the entry (NOT index.html — the bridge imports the entry
      // after it has seeded identity/permissions/theme, so index.html must not
      // auto-inject the module script).
      input: 'src/main.js',
      output: {
        entryFileNames: 'assets/rom-module-entry.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (info) => {
          const name = info.name || (info.names && info.names[0]) || '';
          // Only the module's own stylesheet gets a stable name (index.html links
          // it). Third-party CSS (e.g. leaflet) is loaded on demand by its chunk,
          // so keep it hashed to avoid a name collision with rom-module.css.
          if (name.endsWith('.css') && !/leaflet/i.test(name)) return 'assets/rom-module.css';
          return 'assets/[name]-[hash][extname]';
        },
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@supabase')) return 'vendor-supabase';
          return undefined;
        },
      },
    },
  },
});
