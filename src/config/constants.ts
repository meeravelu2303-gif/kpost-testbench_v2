import path from 'node:path';

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const STORAGE_STATE = path.join(ROOT_DIR, '.auth', 'user.json');
/** The 2nd QA account's session, for two-session tests (a sender + a receiver). */
export const STORAGE_STATE_2 = path.join(ROOT_DIR, '.auth', 'user2.json');
/** The 3rd QA account's session, for Cc / Confidential-Copy (NFR-SEC02) / bulk verification. */
export const STORAGE_STATE_3 = path.join(ROOT_DIR, '.auth', 'user3.json');
/** A BUSINESS_S admin's session, for the company-admin UI (User Management on the main app). */
export const STORAGE_STATE_BUSINESS = path.join(ROOT_DIR, '.auth', 'business.json');
/**
 * A BUSINESS_M admin's session for the **Admin/HR-Setup UI** on the separate `kpostadmin` origin.
 * Holds the SSO-planted localStorage (`accessToken` + `AuthUser` + `companyID`) that its own
 * `Callback.js` writes, so the admin app boots straight to `/dashboard`.
 */
export const STORAGE_STATE_ADMIN = path.join(ROOT_DIR, '.auth', 'admin.json');
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
