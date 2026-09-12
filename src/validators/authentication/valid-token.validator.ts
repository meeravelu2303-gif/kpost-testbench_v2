import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';

export const validTokenValidator = defineValidator({
  name: 'authentication.valid-token',
  category: 'AUTHENTICATION',
  severity: 'CRITICAL',
  description: 'A valid token of an allowed role is accepted',
  toggle: 'authentication',
  appliesTo: ({ endpoint }) => (endpoint.authentication.required ? true : 'endpoint is public'),
  check: ({ primary, endpoint }) => {
    const rejected = [401, 403, ...endpoint.authentication.failureStatus.invalid].includes(
      primary.status,
    );
    const extras = { expected: `not ${[401, 403].join('/')}`, actual: primary.status };
    return rejected
      ? outcome.failed(
          `valid ${endpoint.authentication.role} token was rejected with ${primary.status}`,
          extras,
        )
      : outcome.passed(`valid ${endpoint.authentication.role} token accepted`, extras);
  },
});
