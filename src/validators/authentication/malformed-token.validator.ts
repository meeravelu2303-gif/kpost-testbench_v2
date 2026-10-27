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
  // The gateway 401s any unrouted path without a token, so a 404 primary leaves auth unverifiable.
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
