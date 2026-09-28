import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/test/global-setup.ts'],
    setupFiles: ['src/test/setup.ts'],
    // Route handlers share a single Postgres database, so specs run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
