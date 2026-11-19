import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// CesiumJS needs its web workers and assets at /cesium (public/cesium, git-ignored, copied from
// node_modules). Copy them as part of Vite itself, so every build has them - whatever command
// the host runs (`vite build` on Vercel/Netlify, pnpm/yarn skipping "prebuild" hooks...).
// Without them the 3D globe stops with "An error occurred while rendering ... [object Object]".
function cesiumAssets() {
  const copy = () =>
    execFileSync(process.execPath, [fileURLToPath(new URL('./scripts/copy-cesium-assets.mjs', import.meta.url))], { stdio: 'inherit' });
  return {
    name: 'inner-map-cesium-assets',
    // runs before Vite copies public/ into dist/ (and before the dev server starts)
    configResolved: copy,
  };
}

// The React app calls the API with relative URLs (/api/...). Vite forwards them to
// the Express server, so the browser sees one origin (no CORS issues, and the
// service worker can treat everything under "/" as the app).
const proxy = {
  '/api': { target: 'http://localhost:5000', changeOrigin: true },
  '/tiles': { target: 'http://localhost:5000', changeOrigin: true },
  '/globe-data': { target: 'http://localhost:5000', changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), cesiumAssets()],
  server: {
    port: 5173,
    proxy,
    // ../shared holds the routing engine used by both the browser and the backend.
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
  preview: { port: 4173, proxy },
  worker: { format: 'es' },
  build: {
    // Keep every 2D page in the main bundle so the service worker caches the whole app on the
    // first visit. The 3D globe (CesiumJS, ~4 MB) is a separate chunk loaded only when opened,
    // which is why the warning limit is high.
    chunkSizeWarningLimit: 4500,
  },
});
