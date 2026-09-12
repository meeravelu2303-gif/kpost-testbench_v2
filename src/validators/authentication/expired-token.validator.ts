import { authConfig } from '@config/auth.config';
import { runProbes } from '@engine/probe';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';

export const expiredTokenValidator = defineValidator({
  name: 'authentication.expired-token',
  category: 'AUTHENTICATION',
  severity: 'HIGH',
  description: 'An expired token is rejected',
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
    const token = await context.expiredToken();
    if (!token)
      return outcome.skipped('no expired token available for this environment (set EXPIRED_TOKEN)');
    return runProbes(
      context,
      'authentication.expired-token',
      [
        {
          name: 'expired token',
          spec: context.request,
          auth: { header: `${authConfig.scheme} ${token}` },
          expectedStatus: context.endpoint.authentication.failureStatus.expired,
        },
      ],
      'expired-token cases',
    );
  },
});
