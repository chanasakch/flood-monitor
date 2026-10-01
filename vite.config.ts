import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

/**
 * Writes Cloudflare's `_headers` file with a Content-Security-Policy that allows exactly the
 * one inline script in index.html (by hash), our own files, and the OpenFreeMap tile server.
 */
function securityHeaders(): Plugin {
  return {
    name: 'fm-security-headers',
    apply: 'build',
    // Runs after the build has written dist/, so the hash matches the final index.html exactly.
    closeBundle() {
      const html = readFileSync('dist/index.html', 'utf8');
      const inlineHashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
      );
      const csp = [
        "default-src 'self'",
        `script-src 'self' ${inlineHashes.join(' ')}`.trim(),
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://tiles.openfreemap.org",
        "font-src 'self'",
        "connect-src 'self' https://tiles.openfreemap.org https://api-v3.thaiwater.net",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
      ].join('; ');
      const source = [
        '/*',
        `  Content-Security-Policy: ${csp}`,
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: strict-origin-when-cross-origin',
        '  Permissions-Policy: geolocation=(self), camera=(), microphone=()',
        '',
        '/assets/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '',
        '/sw.js',
        '  Cache-Control: no-cache',
        '',
      ].join('\n');
      writeFileSync('dist/_headers', source);
    },
  };
}

export default defineConfig({
  plugins: [securityHeaders()],
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200, // the map library is large but loads only on the map page
  },
  server: {
    // `npm run dev:web` serves the UI with hot reload and forwards API calls to `wrangler dev`.
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
