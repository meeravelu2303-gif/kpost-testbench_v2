import { randomBytes } from 'node:crypto';
import { authConfig } from '@config/auth.config';
import { runProbes } from '@engine/probe';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';
import { tamperSignature } from '@utils/jwt';

const HOUR_SECONDS = 3_600;

function foreignSignedToken(): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + HOUR_SECONDS;
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'intruder', role: 'SUPER_ADMIN', exp })}.${randomBytes(32).toString('base64url')}`;
}

export const invalidTokenValidator = defineValidator({
  name: 'authentication.invalid-token',
  category: 'AUTHENTICATION',
  severity: 'CRITICAL',
  description: 'Well-formed tokens with an invalid signature are rejected',
  toggle: 'authentication',
  profiles: PROFILE_SETS.DEEP_AND_SECURITY,
  stage: 'probe',
  /*
   * An auth probe proves nothing when the route does not exist.
   *
   * This gateway answers 401 to ANY unrouted path without a token, and 404 with one - verified
   * against `/common/definitelyNotARoute9f2a`. So "no token -> 401" is the default for everything,
   * and reading it as "the endpoint is protected" is a false pass: the same 401 comes back for an
   * endpoint that was never deployed. When the primary call 404s, auth is unverifiable and the
   * probe says so instead of passing.
   */
  appliesTo: ({ endpoint, primary }) => {
    if (!endpoint.authentication.required) return 'endpoint is public';
    if (primary.status === 404)
      return 'endpoint answered 404: the route is unknown, so auth cannot be verified';
    return true;
  },
  check: async (context) => {
    const principal = context.principal(context.endpoint.authentication.role);
    if (!principal)
      return outcome.skipped(
        `no principal configured for role ${context.endpoint.authentication.role}`,
      );
    const validToken = await context.tokenFor(principal);
    const expectedStatus = context.endpoint.authentication.failureStatus.invalid;
    return runProbes(
      context,
      'authentication.invalid-token',
      [
        {
          name: 'tampered signature',
          spec: context.request,
          auth: { header: `${authConfig.scheme} ${tamperSignature(validToken)}` },
          expectedStatus,
        },
        {
          name: 'token signed with foreign key',
          spec: context.request,
          auth: { header: `${authConfig.scheme} ${foreignSignedToken()}` },
          expectedStatus,
        },
      ],
      'invalid-token cases',
    );
  },
});
