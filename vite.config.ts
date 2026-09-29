import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './extension/src'),
      '@shared': path.resolve(__dirname, './packages/shared'),
      '@schemas': path.resolve(__dirname, './packages/schemas'),
      '@ai': path.resolve(__dirname, './packages/ai'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: path.resolve(__dirname, 'extension/src/background/index.ts'),
        content: path.resolve(__dirname, 'extension/src/content/index.ts'),
        popup: path.resolve(__dirname, 'extension/src/popup/main.tsx'),
        options: path.resolve(__dirname, 'extension/src/options/main.tsx'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
});