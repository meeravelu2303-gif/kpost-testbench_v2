import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';

export const timeoutValidator = defineValidator({
  name: 'performance.timeout',
  category: 'PERFORMANCE',
  severity: 'HIGH',
  description: 'The primary request completes before the request timeout',
  toggle: 'performance',
  check: ({ primary, endpoint }) => {
    const extras = {
      expected: `response within ${endpoint.performance.timeoutMs}ms`,
      actual: primary.transportError?.kind ?? 'responded',
    };
    if (primary.transportError?.kind === 'timeout') {
      return outcome.failed(`no response within ${endpoint.performance.timeoutMs}ms`, extras);
    }
    if (primary.transportError)
      return outcome.failed(`network error: ${primary.transportError.message}`, extras);
    return outcome.passed(`responded in ${primary.durationMs}ms`, extras);
  },
});
