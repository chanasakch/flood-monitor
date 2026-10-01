import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
  },
  server: {
    // `npm run dev:web` serves the UI with hot reload and forwards API calls to `wrangler dev`.
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
