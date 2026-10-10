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
    // On an endpoint whose valid request needs a record the sweep lacks, 403 is the owner check
    // refusing a stranger's record, not a rejected token; only 401 means the token was refused.
    const rejectedStatuses = endpoint.definition.precondition
      ? [401, ...endpoint.authentication.failureStatus.invalid.filter((status) => status !== 403)]
      : [401, 403, ...endpoint.authentication.failureStatus.invalid];
    const rejected = rejectedStatuses.includes(primary.status);
    const extras = { expected: `not ${[401, 403].join('/')}`, actual: primary.status };
    return rejected
      ? outcome.failed(
          `valid ${endpoint.authentication.role} token was rejected with ${primary.status}`,
          extras,
        )
      : outcome.passed(`valid ${endpoint.authentication.role} token accepted`, extras);
  },
});
