import { runProbes } from '@engine/probe';
import { defineValidator } from '@engine/validator';

export const missingTokenValidator = defineValidator({
  name: 'authentication.missing-token',
  category: 'AUTHENTICATION',
  severity: 'CRITICAL',
  description: 'A request without credentials is rejected',
  toggle: 'authentication',
  stage: 'probe',
  appliesTo: ({ endpoint }) => (endpoint.authentication.required ? true : 'endpoint is public'),
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
