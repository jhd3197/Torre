/// <reference types="vitest/config" />
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The Python server (studio.py) serves the built app from ../studio/ui.
// Built asset paths are relative; studio.py adds a <base href> pointing at the
// app root, so they also work under a proxy prefix such as Vela's /apps/chess/.
const studio = process.env.STUDIO_URL ?? 'http://127.0.0.1:1886';

// In development Vite serves every route at the root, so the app root is "/".
// (In production studio.py writes a relative <base> for each page instead.)
const devBase: Plugin = {
  name: 'chess-studio-dev-base',
  apply: 'serve',
  transformIndexHtml: html => html.replace('<head>', '<head><base href="/">'),
};

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react(), devBase],
  build: {
    outDir: '../studio/ui',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // Pages are lazy route chunks (App.tsx). On top of that: the framework in one long-cached
        // vendor chunk, and each language's UI strings in one chunk (instead of ~30 tiny ones).
        // content.json stays its own chunk per language; it loads only with the data that uses it.
        codeSplitting: {
          groups: [
            { name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|i18next|react-i18next)[\\/]/, priority: 2 },
            {
              name: (id: string) => {
                const [, lang, ns] = id.match(/[\\/]i18n[\\/]locales[\\/](\w+)[\\/]([\w-]+)\.json$/) ?? [];
                if (!lang) return null;
                return ns === 'content' ? `content-${lang}` : `i18n-${lang}`;
              },
              priority: 1,
            },
          ],
        },
      },
    },
  },
  // changeOrigin off: the string shorthand rewrites Host to the studio's port, which then no longer
  // matches the page's Origin, and studio.py refuses every POST as cross-origin.
  // /audio is the installed voice packs (studio.py serves them from the data folder).
  // content/grading.json sits beside the Python that reads it too; the dev server may serve it.
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), '../content/grading.json'] }, proxy: { '/api': { target: studio, changeOrigin: false }, '/pieces': { target: studio, changeOrigin: false }, '/audio': { target: studio, changeOrigin: false } } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], css: false },
}));
