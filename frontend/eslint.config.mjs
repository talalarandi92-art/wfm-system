// ESLint flat config — frontend (React + Vite).
// PRAGMATIC CORRECTNESS-ONLY gate: no style rules, no no-unused-vars, no no-explicit-any.
// react-hooks: ONLY rules-of-hooks (a broken hook order is a real crash);
// exhaustive-deps stays OFF — legacy code violates it everywhere and "fixing"
// dependency arrays changes runtime behavior. Wired into backend/scripts/verify-all.cjs.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    // Legacy files carry eslint-disable comments for rules we intentionally keep
    // off (e.g. exhaustive-deps) — don't warn about them, don't delete them.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
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
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];
