import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
    include: ['test/**/*.test.ts'],
  },
});
