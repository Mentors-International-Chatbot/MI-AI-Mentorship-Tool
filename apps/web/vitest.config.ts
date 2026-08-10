import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // iCloud writes "<name> 2.ts" beside a file when it resolves a sync
    // conflict. A stale copy of a test file would run against current source
    // and fail for reasons nobody can find in the diff.
    exclude: ['**/node_modules/**', '**/* [0-9].*'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

