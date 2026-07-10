// Vitest — frontend smoke-test runner (wired into backend/scripts/verify-all.cjs).
// environment 'node' on purpose: the smoke tests exercise PURE helpers
// (src/utils/format.ts, src/components/ds.tsx tokens) — no DOM, no jsdom, fast.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
