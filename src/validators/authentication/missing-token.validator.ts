import { runProbes } from '@engine/probe';
import { defineValidator } from '@engine/validator';

export const missingTokenValidator = defineValidator({
  name: 'authentication.missing-token',
  category: 'AUTHENTICATION',
  severity: 'CRITICAL',
  description: 'A request without credentials is rejected',
  toggle: 'authentication',
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
  check: (context) =>
    runProbes(
      context,
      'authentication.missing-token',
      [
        {
          name: 'no Authorization header',
          spec: context.request,
          auth: { header: undefined },
          expectedStatus: context.endpoint.authentication.failureStatus.missing,
        },
      ],
      'missing-token cases',
    ),
});
