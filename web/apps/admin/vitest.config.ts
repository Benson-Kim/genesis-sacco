import { defineConfig } from 'vitest/config';

export default defineConfig({
  // apps/admin's tsconfig sets `"jsx": "preserve"` (Next.js compiles JSX
  // itself via SWC at build time) — Vitest's esbuild transform picks that
  // up too by default, which leaves JSX untransformed and breaks tests.
  // Override it here so the test runner always uses the automatic runtime.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Playwright owns e2e/ (see playwright.config.ts) — Vitest's default
    // include glob would otherwise also pick up *.spec.ts here and fail
    // with "did not expect test() to be called" (two different test
    // runners' `test()` colliding).
    exclude: ['e2e/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});
