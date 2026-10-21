import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist-electron/main/electron',
      emptyOutDir: false,
      rollupOptions: {
        input: path.resolve(__dirname, 'electron/main.ts'),
        output: {
          format: 'cjs',
          entryFileNames: 'main.js',
        },
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist-electron/main/electron',
      emptyOutDir: false,
      rollupOptions: {
        input: path.resolve(__dirname, 'electron/preload.ts'),
        output: {
          format: 'cjs',
          entryFileNames: 'preload.js',
        },
      },
    },
  },
  renderer: {
    root: path.resolve(__dirname, 'electron'),
    resolve: {
      alias: {
        '@nonu': path.resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'dist-electron/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'electron/index.html'),
      },
    },
    plugins: [react({ jsxRuntime: 'automatic' })],
  },
});
