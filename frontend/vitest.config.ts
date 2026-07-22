// Vitest — frontend smoke-test runner (wired into backend/scripts/verify-all.cjs).
// environment 'node' on purpose: the smoke tests exercise PURE helpers
// (src/utils/format.ts, src/components/ds.tsx tokens) — no DOM, no jsdom, fast.
//
// The `@` alias mirrors tsconfig/vite. Without it, any test whose subject imports
// a sibling that uses `@/…` fails to COLLECT — which reads like a broken test
// instead of a missing config line.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
