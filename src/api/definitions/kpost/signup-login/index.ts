import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { loginApis } from './login.api';
import { signupApis } from './signup.api';

/**
 * The KPost **Signup & Login** module — `/v2/signupLogin/*` plus the medium/large business login.
 *
 * FR-S01..S12 in the FRD: registration, activation, session, logout. It is the gate to the whole
 * product, and the module every other one depends on: `AUTH_PROFILES.kpost` logs in here to get
 * the token that KMail, Admin and the authenticated KPost endpoints need.
 *
 *   login.api.ts   login, token refresh, sessions, logout, access code
 *   signup.api.ts  registration, business registration, availability checks
 */
export const signupLoginApis: EndpointDefinition[] = [...loginApis, ...signupApis];

/**
 * Documented paths in this module that no definition covers.
 *
 * Asserted by tests/api/kpost/signup-login/coverage.spec.ts, so a future workbook dump that adds
 * an endpoint here fails the run instead of being quietly untested.
 */
export function uncoveredSignupLoginPaths(): string[] {
  const covered = new Set(signupLoginApis.map((api) => api.path));
  return contractPaths('kpost-api').filter(
    (path) => /signuplogin/i.test(path) && !covered.has(path),
  );
}
