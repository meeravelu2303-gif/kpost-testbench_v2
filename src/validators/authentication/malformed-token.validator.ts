import { authConfig } from '@config/auth.config';
import { runProbes } from '@engine/probe';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';

/** Covers malformed tokens, empty tokens and incorrect Bearer formats. */
export const malformedTokenValidator = defineValidator({
  name: 'authentication.malformed-token',
  category: 'AUTHENTICATION',
  severity: 'HIGH',
  description: 'Malformed, empty or wrongly formatted credentials are rejected',
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
    const token = await context.tokenFor(principal);
    const scheme = authConfig.scheme;
    const headers: Record<string, string> = {
      'empty token': `${scheme} `,
      'not a JWT': `${scheme} not-a-jwt`,
      'two-segment token': `${scheme} abc.def`,
      'missing Bearer scheme': token,
      'wrong scheme (Token)': `Token ${token}`,
      'Basic credentials': `Basic ${Buffer.from('user:guess').toString('base64')}`,
      'double scheme': `${scheme} ${scheme} ${token}`,
    };
    return runProbes(
      context,
      'authentication.malformed-token',
      Object.entries(headers).map(([name, header]) => ({
        name,
        spec: context.request,
        auth: { header },
        expectedStatus: context.endpoint.authentication.failureStatus.malformed,
      })),
      'malformed-token cases',
    );
  },
});
