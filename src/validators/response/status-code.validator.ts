import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';

export const statusCodeValidator = defineValidator({
  name: 'response.status-code',
  category: 'RESPONSE',
  severity: 'CRITICAL',
  description: "The primary response status is one of the endpoint's expected statuses",
  toggle: 'statusCode',
  check: ({ primary, endpoint }) => {
    const extras = { expected: endpoint.expectedStatus, actual: primary.status };
    if (primary.transportError)
      return outcome.failed(`no HTTP response: ${primary.transportError.message}`, extras);
    return endpoint.expectedStatus.includes(primary.status)
      ? outcome.passed(`status ${primary.status}`, extras)
      : outcome.failed(
          `expected ${endpoint.expectedStatus.join('/')}, got ${primary.status}`,
          extras,
        );
  },
});
