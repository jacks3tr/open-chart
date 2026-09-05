import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    server: {
      deps: {
        // This is generated plain-ESM data, not application code. Rewriting its
        // 11 MB payload inside each test worker obscures actual catalog load time.
        // Keep all source modules transformed and all catalog assertions enabled.
        external: [/[/\\]packages[/\\]shapes[/\\]generated[/\\]icon-libraries\.js$/],
      },
    },
  },
});
