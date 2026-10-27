import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'node_modules/',
      'playwright-report/',
      'test-results/',
      'blob-report/',
      '.auth/',
      'reports/',
      'junit-report/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    extends: [playwright.configs['flat/recommended']],
    rules: {
      'playwright/no-focused-test': 'error',
      // A warning: existing live-tuned "settle" waits are replaced when their spec is next tuned;
      // new code must wait on a condition instead.
      'playwright/no-wait-for-timeout': 'warn',
      'playwright/no-page-pause': 'error',
      // Environment-conditional skips (e.g. a module whose host is not configured) are intentional.
      'playwright/no-skipped-test': ['warn', { allowConditional: true }],
      // Shared helpers that assert, so the rule does not flag tests that call them.
      'playwright/expect-expect': [
        'warn',
        {
          assertFunctionNames: [
            'expect',
            'assertNoFileableIssues',
            'runUiChecks',
            'scanCurrentPage',
            // The smoke helpers (tests/support/smoke/, tests/kpost-ui/smoke/).
            'expectSmokeRead',
            'expectModuleScreensLoad',
            'expectAdminScreenLoads',
            'callJourney',
            'tierLifecycle',
            'topVariableLifecycle',
            'locationLifecycle',
            'employeeLifecycle',
          ],
        },
      ],
      // Off: specs branch on live state on purpose (a check that cannot run says SKIPPED, never
      // PASSED); `expect-expect` guards against a test that does nothing.
      'playwright/no-conditional-in-test': 'off',
      'playwright/no-conditional-expect': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    // Node globals for the ESM build/runner scripts (scripts/*.mjs).
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        // Node ≥ 18 web globals (the run-level environment check).
        fetch: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
  {
    // Build-time Node scripts: CommonJS, outside the TypeScript program.
    files: ['**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    // `require()` is how a CommonJS build script imports; the ESM rule does not apply here.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
    languageOptions: {
      sourceType: 'commonjs',
      parserOptions: { projectService: false },
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        // Node ≥ 18 web globals the Bugzilla/account scripts use.
        fetch: 'readonly',
        URLSearchParams: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
);
