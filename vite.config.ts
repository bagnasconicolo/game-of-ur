import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  publicDir: 'public',
  build: { outDir: '../../dist', emptyOutDir: true, chunkSizeWarningLimit: 900, target: 'es2022' },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
});
