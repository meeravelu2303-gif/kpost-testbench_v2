import { runProbes } from '@engine/probe';
import { defineValidator } from '@engine/validator';

export const missingTokenValidator = defineValidator({
  name: 'authentication.missing-token',
  category: 'AUTHENTICATION',
  severity: 'CRITICAL',
  description: 'A request without credentials is rejected',
  toggle: 'authentication',
  stage: 'probe',
  // The gateway 401s any unrouted path without a token, so a 404 primary leaves auth unverifiable.
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
