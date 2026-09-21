import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    isolate: true,
    poolOptions: {
      forks: {
        execArgv: ['--disable-warning=ExperimentalWarning'],
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default'],
  },
  resolve: {
    alias: {
      '@db': path.resolve(__dirname, 'server/src/db'),
      '@config': path.resolve(__dirname, 'server/src/config'),
      '@container': path.resolve(__dirname, 'server/src/container'),
      '@app': path.resolve(__dirname, 'server/src/app'),
    },
  },
});