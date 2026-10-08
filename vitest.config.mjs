import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.{test,spec}.{ts,tsx}', 'scripts/*.test.mjs'],
    server: {
      deps: {
        // This is generated plain-ESM data, not application code. Rewriting its
        // Catalog payloads inside each test worker obscure actual catalog load time.
        // Keep all source modules transformed and all catalog assertions enabled.
        external: [/[/\\]packages[/\\]shapes[/\\]generated[/\\].*\.js$/],
      },
    },
  },
});
