import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.integration.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000
  }
});
