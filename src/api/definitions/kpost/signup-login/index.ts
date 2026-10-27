import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { loginApis } from './login.api';
import { signupApis } from './signup.api';

/**
 * Signup & Login (`/v2/signupLogin/*` plus the medium/large business login). Login mints every
 * token; signup runs on the OTP test gateway.
 */
export const signupLoginApis: EndpointDefinition[] = [...loginApis, ...signupApis];

/** Paths deliberately out of scope (none); kept so the coverage self-test has a hook. */
export const SIGNUP_OUT_OF_SCOPE: readonly string[] = [];

/** Documented paths in this module no definition covers; asserted by coverage.spec.ts. */
export function uncoveredSignupLoginPaths(): string[] {
  const covered = new Set(signupLoginApis.map((api) => api.path));
  const outOfScopePaths = new Set(SIGNUP_OUT_OF_SCOPE.map((entry) => entry.split(' ')[1]));
  return contractPaths('kpost-api').filter(
    (path) => /signuplogin/i.test(path) && !covered.has(path) && !outOfScopePaths.has(path),
  );
}
