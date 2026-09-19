import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { loginApis } from './login.api';
import { signupApis } from './signup.api';

/**
 * The KPost **Signup & Login** module — `/v2/signupLogin/*` plus the medium/large business login.
 *
 * Login (FR-SL-023..026, 032) is the module every other one depends on: `AUTH_PROFILES.kpost` logs in
 * here to get the token the authenticated endpoints need. **Signup is back in scope (2026-09-19):** the
 * testingapi test DB runs a TEST GATEWAY (no real SMS, `123456` validates), so registration and the OTP
 * flows run end to end with `OTP_TEST_GATEWAY=true` + `TEST_DB_MODE=true`. See `signup.api.ts`.
 */
export const signupLoginApis: EndpointDefinition[] = [...loginApis, ...signupApis];

/**
 * Nothing under `/signupLogin` is deliberately out of scope any more — signup is covered on the OTP
 * test gateway. Kept as an (empty) named list so the coverage self-test still has a hook, and a NEW
 * uncovered `/signupLogin` path fails the run rather than being swallowed.
 */
export const SIGNUP_OUT_OF_SCOPE: readonly string[] = [];

/**
 * Documented paths in this module that no definition covers and that are not deliberately out of
 * scope.
 *
 * Asserted by tests/api/kpost/signup-login/coverage.spec.ts, so a future workbook dump that adds
 * an endpoint here fails the run instead of being quietly untested.
 */
export function uncoveredSignupLoginPaths(): string[] {
  const covered = new Set(signupLoginApis.map((api) => api.path));
  const outOfScopePaths = new Set(SIGNUP_OUT_OF_SCOPE.map((entry) => entry.split(' ')[1]));
  return contractPaths('kpost-api').filter(
    (path) => /signuplogin/i.test(path) && !covered.has(path) && !outOfScopePaths.has(path),
  );
}
