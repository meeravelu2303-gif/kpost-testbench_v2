import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { loginApis } from './login.api';

/**
 * The KPost **Login & session** module — `/v2/signupLogin/*` plus the medium/large business login.
 *
 * FR-S09..S12 in the FRD: login, session, logout. It is the module every other one depends on:
 * `AUTH_PROFILES.kpost` logs in here to get the token the authenticated endpoints need.
 *
 * **Signup is out of scope.** The QA accounts were created by hand, and both registration
 * endpoints need a validated OTP that the live application has no bypass for. The five
 * registration endpoints were removed rather than left registered-but-skipped, so the run and the
 * reports describe only what is actually tested. Their findings are kept in CLAUDE.md §8.
 */
export const signupLoginApis: EndpointDefinition[] = [...loginApis];

/**
 * Registration paths deliberately left untested. Named, not pattern-matched, so a NEW endpoint under
 * `/signupLogin` still shows up as uncovered instead of being swallowed by the exclusion.
 */
export const SIGNUP_OUT_OF_SCOPE: readonly string[] = [
  'GET /v2/signupLogin/signup/',
  'POST /v2/signupLogin/signup/',
  'POST /v2/signupLogin/adminRegistration/',
  'POST /v2/signupLogin/kpostIdExist/',
  'POST /v2/signupLogin/kpostIDsuggestionList/',
];

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
