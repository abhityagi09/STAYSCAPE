import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const envDir = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig(({ mode, command }) => {
  // The monorepo keeps a single .env at the repository root.
  const env = loadEnv(mode, envDir, '');
  if (
    command === 'build' &&
    mode === 'production' &&
    env.NODE_ENV &&
    env.NODE_ENV !== 'production'
  ) {
    // Vite applies NODE_ENV from .env files, which would bundle React's development build.
    throw new Error(
      `Refusing to build: NODE_ENV=${env.NODE_ENV} is set in the environment or .env. Remove it for web builds.`,
    );
  }
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:4000';

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin proxy so the HttpOnly refresh cookie is first-party in development.
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    preview: { port: 4173, proxy: { '/api': { target: apiTarget } } },
    build: {
      sourcemap: true,
      target: 'es2022',
      rollupOptions: {
        output: {
          // Path-based so sub-path imports (e.g. react-dom/client) land in the right vendor chunk.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules\/(react|react-dom|scheduler|react-router)\//.test(id)) return 'react';
            if (
              /node_modules\/(@tanstack|axios|@reduxjs|react-redux|redux|immer|reselect)\//.test(id)
            )
              return 'data';
            if (/node_modules\/(react-hook-form|@hookform|zod)\//.test(id)) return 'forms';
            if (/node_modules\/(tailwind-merge|clsx|lucide-react)\//.test(id)) return 'ui';
            // The map stack is large and only used on map views: keep it out of the shared chunk
            // so it downloads only when a map is shown (MapView imports it dynamically).
            if (
              /node_modules\/(maplibre-gl|@maplibre|@mapbox|earcut|kdbush|gl-matrix|pbf|potpack|quickselect|tinyqueue|supercluster|murmurhash-js|geojson-vt|@turf|bidi-js)\//.test(
                id,
              )
            )
              return 'maplibre';
            return 'vendor';
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      // Form tests type character by character; allow for a loaded CI machine.
      testTimeout: 20_000,
    },
  };
});
