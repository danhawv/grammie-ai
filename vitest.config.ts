import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  define: { __APP_BUILD__: 'false' },
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'shared'),
      '@': path.resolve(import.meta.dirname, 'client', 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'client/src/lib/**/*.test.ts', 'client/src/native/**/*.test.ts'],
    // The PDF smoke test launches Chromium and renders a real book
    testTimeout: 60_000,
  },
});
