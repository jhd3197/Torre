// ESLint 9 flat config: typescript-eslint, the Rules of Hooks and exhaustive effect deps.
import { createRequire } from 'node:module';
import Module from 'node:module';
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// The project compiles with TypeScript 7, which ships no JavaScript API; typescript-eslint's parser
// needs one (<6.1). It gets TypeScript 6 from the `typescript-eslint-ts` alias instead.
const require = createRequire(import.meta.url);
const ts6 = require.resolve('typescript-eslint-ts');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolve.call(this, request === 'typescript' ? ts6 : request, ...rest);
};
const { default: tseslint } = await import('typescript-eslint');

export default tseslint.config(
  { ignores: ['node_modules', 'dist', '../studio/ui'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
