import { defineConfig } from 'tsup';

// Builds the two Node entry points shipped in the Docker image / npm package.
// The Cloudflare Workers entry (src/entry/worker.ts) is bundled by Wrangler
// directly from source, so it is intentionally not listed here.
export default defineConfig({
  entry: {
    'entry/node': 'src/entry/node.ts',
    'entry/stdio': 'src/entry/stdio.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  minify: false,
  // stdio.js is executed via the `bin` field, so it needs a shebang.
  banner: { js: '#!/usr/bin/env node' },
});
