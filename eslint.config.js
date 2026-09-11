const { defineConfig, globalIgnores } = require('eslint/config')

const tsParser = require('@typescript-eslint/parser')
const typescriptEslint = require('@typescript-eslint/eslint-plugin')
const js = require('@eslint/js')
const nextPlugin = require('@next/eslint-plugin-next')
const reactHooksPlugin = require('eslint-plugin-react-hooks')

const { FlatCompat } = require('@eslint/eslintrc')

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

module.exports = defineConfig([
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: compat.extends(
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:monorepo/recommended',
      'prettier'
    ),
    plugins: {
      '@typescript-eslint': typescriptEslint,
      '@next/next': nextPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      parserOptions: {
        project: [
          './tsconfig.base.json',
          './packages/*/tsconfig.json',
          './apps/*/tsconfig.json',
          './examples/*/tsconfig.json',
        ],
      },
    },
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      // '@typescript-eslint/no-empty-object-type': ['error', { allowObjectTypes: true }],

      '@typescript-eslint/strict-boolean-expressions': 'off',

      '@next/next/no-img-element': 'off',

      'no-console': 'warn',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  globalIgnores(['**/dist', '**/coverage']),
])
