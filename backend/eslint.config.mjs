// ESLint flat config — backend (NestJS).
// PRAGMATIC CORRECTNESS-ONLY gate: this codebase was never linted, so we do NOT
// enable style rules, no-unused-vars, or no-explicit-any (thousands of hits, zero bugs).
// Every rule here catches a REAL bug class. Wired into scripts/verify-all.cjs.
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    // dist = build output; scripts/ = plain-node operational scripts (recon engine
    // etc. — intentionally out of scope for the TS lint gate, see CLAUDE.md).
    ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-sparse-arrays': 'error',
      'valid-typeof': 'error',
      'use-isnan': 'error',
      eqeqeq: ['error', 'smart'],
      'no-async-promise-executor': 'error',
      'no-self-assign': 'error',
      'no-cond-assign': 'error',
      '@typescript-eslint/no-misused-new': 'error',
    },
  },
];
