import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public/data.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Front-end: runs in the browser.
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Tooling & data generation: runs under Node.
    files: ['scripts/**/*.{ts,mjs}', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
