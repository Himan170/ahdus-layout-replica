// ESLint (flat config): catches real mistakes (undefined names, broken hooks),
// not style. No formatter: the code keeps its own style.
// TypeScript (src/engine) is checked by `npm run typecheck`, not here.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/', 'dist-embed/', 'node_modules/', 'public/', 'e2e/screens/', '**/*.ts', '**/*.tsx'] },

  js.configs.recommended,

  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Unused names are common while a feature grows; JSX use isn't seen without the React plugin
      'no-unused-vars': 'off',
      // Empty catch blocks are used on purpose (best-effort storage, optional features)
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Node scripts, configs and the Playwright tests (their page.evaluate bodies run in the browser)
  {
    files: ['scripts/**', 'e2e/**', '*.config.js', 'vite.*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, AHDUSWorkplace: 'readonly' } },
  },

  // Unit tests
  {
    files: ['**/__tests__/**', '**/*.test.{js,jsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
];
