import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const alias = {
  '@': path.resolve(__dirname, './extension/src'),
  '@shared': path.resolve(__dirname, './packages/shared'),
  '@schemas': path.resolve(__dirname, './packages/schemas'),
  '@ai': path.resolve(__dirname, './packages/ai'),
};

function appConfig(mode: string): UserConfig {
  return {
    plugins: [react()],
    resolve: { alias },
    publicDir: 'extension/public',
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          background: path.resolve(__dirname, 'extension/src/background/index.ts'),
          popup: path.resolve(__dirname, 'popup.html'),
          options: path.resolve(__dirname, 'options.html'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    },
  };
}

function contentConfig(mode: string): UserConfig {
  return {
    resolve: { alias },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      emptyOutDir: false,
      rollupOptions: {
        input: path.resolve(__dirname, 'extension/src/content/index.ts'),
        output: {
          entryFileNames: 'content.js',
          inlineDynamicImports: true,
          format: 'es',
        },
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    },
  };
}

export default defineConfig(({ mode }) => {
  return process.env.BUILD_TARGET === 'content' ? contentConfig(mode) : appConfig(mode);
});