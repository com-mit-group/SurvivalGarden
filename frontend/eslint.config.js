import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/**/*.{tsx,jsx}'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['**/domain/**'],
              message:
                'Keep domain logic out of React components; use application-layer adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'Domain code must not depend on React.' },
            { name: 'react-router', message: 'Domain code must not depend on routing libraries.' },
            {
              name: 'react-router-dom',
              message: 'Domain code must not depend on routing libraries.',
            },
            { name: 'idb', message: 'Domain code must not depend on browser persistence adapters.' },
          ],
          patterns: ['react/*', 'react-router/*', 'react-router-dom/*'],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Domain code must not access browser globals.' },
        { name: 'document', message: 'Domain code must not access browser globals.' },
        { name: 'localStorage', message: 'Domain code must not access browser globals.' },
        { name: 'sessionStorage', message: 'Domain code must not access browser globals.' },
        { name: 'navigator', message: 'Domain code must not access browser globals.' },
        { name: 'location', message: 'Domain code must not access browser globals.' },
      ],
    },
  },
);
