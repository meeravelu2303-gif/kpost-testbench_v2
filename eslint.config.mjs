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
      // A warning, not an error, by decision (2026-10-10): the KPost SPA has almost no test ids and
      // pushes state over sockets, so ~85 short "settle" waits exist in UI specs that were tuned live.
      // Rewriting them blind would trade a lint error for flaky tests that auto-file false bugs. New
      // code must prefer a condition (`expect(...).toBeVisible()`, `waitForResponse`); an existing
      // wait is replaced when its spec is next tuned live. The warning keeps the count visible.
      'playwright/no-wait-for-timeout': 'warn',
      'playwright/no-page-pause': 'error',
      // Environment-conditional skips (e.g. a module whose host is not configured) are intentional.
      'playwright/no-skipped-test': ['warn', { allowConditional: true }],
      // The screen sweeps and accessibility scans assert through shared helpers (every check in
      // the catalogue ends in an `expect`); the rule only recognises a literal `expect` unless told.
      'playwright/expect-expect': [
        'warn',
        {
          assertFunctionNames: [
            'expect',
            'assertNoFileableIssues',
            'runUiChecks',
            'scanCurrentPage',
          ],
        },
      ],
      // Off by decision (2026-10-10). The bench runs against a live, shared deployment and its
      // standing rule is "a check that could not run says SKIPPED with a reason, never PASSED" —
      // which means a spec must look at the live state (is the control reachable? did the
      // precondition hold?) and branch. ~200 such branches exist on purpose; a rule that flags all of
      // them carries no signal. The guard against a test that silently does nothing is
      // `expect-expect` above, and the live run itself.
      'playwright/no-conditional-in-test': 'off',
      'playwright/no-conditional-expect': 'off',
    },
  },
  { files: ['**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
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
