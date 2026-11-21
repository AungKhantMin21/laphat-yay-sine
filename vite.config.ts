import { defineConfig } from 'vitest/config';

// Minimum browsers: iOS Safari 15+, Android Chrome 90+, current desktop browsers (see CLAUDE.md).
const target = ['es2020', 'safari15', 'chrome90', 'firefox115', 'edge90'];

// GitHub Pages runs Jekyll on the site repo, which drops files whose names start with "_".
function noLeadingUnderscore(name: string): string {
  return name.replace(/^_+/, 'x');
}

export default defineConfig({
  base: '/games/laphat-yay-sine/',
  build: {
    target,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        sanitizeFileName: noLeadingUnderscore,
      },
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
