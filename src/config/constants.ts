import path from 'node:path';

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const STORAGE_STATE = path.join(ROOT_DIR, '.auth', 'user.json');
export const REPORTS_DIR = path.join(ROOT_DIR, 'reports');
export const OPENAPI_DIR = path.join(ROOT_DIR, 'openapi');

export const TIMEOUTS = {
  test: 60_000,
  expect: 10_000,
  action: 15_000,
  navigation: 30_000,
} as const;

export const TAGS = {
  smoke: '@smoke',
  regression: '@regression',
  /** Tests that create/modify/delete data. Excluded in production unless explicitly allowed. */
  destructive: '@destructive',
} as const;

/** Validation profiles decide which centralized validators run (see validation-policy.ts). */
export const VALIDATION_PROFILES = ['SMOKE', 'REGRESSION', 'SECURITY', 'FULL'] as const;
export type ValidationProfile = (typeof VALIDATION_PROFILES)[number];
