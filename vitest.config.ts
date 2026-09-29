import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './extension/src'),
      '@shared': path.resolve(__dirname, './packages/shared'),
      '@schemas': path.resolve(__dirname, './packages/schemas'),
      '@ai': path.resolve(__dirname, './packages/ai'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});