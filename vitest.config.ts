import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@nonu': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // parseLogXml uses DOMParser, which exists in the renderer but not in Node.
    // jsdom provides DOMParser for test compatibility.
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
