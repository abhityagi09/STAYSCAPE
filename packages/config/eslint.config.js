import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Shared flat ESLint configuration for the STAYSCAPE monorepo.
 * Type-aware rules are intentionally not enabled to keep linting fast;
 * `npm run typecheck` provides full type safety.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/var/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: [
      'apps/api/**/*.ts',
      'packages/**/*.ts',
      'scripts/**/*.{js,mjs,ts}',
      'tests/**/*.ts',
      '*.config.{js,ts}',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'apps/api/src/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // mongosh scripts run inside the MongoDB shell
    // k6 load-test scripts run in the k6 JavaScript runtime.
    files: ['tests/load/**/*.js'],
    languageOptions: { globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' } },
  },
  {
    files: ['infrastructure/mongo/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { rs: 'readonly', db: 'readonly', quit: 'readonly', print: 'readonly' },
    },
  },
  {
    files: ['apps/web/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser }, sourceType: 'script' },
  },
  {
    files: ['apps/web/**/*.tsx'],
    ...jsxA11y.flatConfigs.recommended,
  },
  {
    files: ['apps/web/**/*.tsx'],
    rules: {
      // Scrollable regions must be keyboard-focusable (WCAG 2.1.1), so allow tabIndex on role="region".
      'jsx-a11y/no-noninteractive-tabindex': [
        'error',
        { tags: [], roles: ['tabpanel', 'region'], allowExpressionValues: true },
      ],
    },
  },
  prettier,
);
