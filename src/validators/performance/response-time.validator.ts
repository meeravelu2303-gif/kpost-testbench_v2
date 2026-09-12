import { thresholds } from '@config/thresholds.config';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';

/**
 * Functional, per-request latency budget of the primary request. This is NOT load testing —
 * one request on a shared test environment; keep load/performance tests in a separate suite.
 */
export const responseTimeValidator = defineValidator({
  name: 'performance.response-time',
  category: 'PERFORMANCE',
  severity: 'MEDIUM',
  description: 'Primary response time is within the endpoint budget (thresholds.config.ts)',
  toggle: 'performance',
  dependsOn: ['performance.timeout'],
  check: ({ primary, endpoint }) => {
    const budget = endpoint.performance.maxResponseTimeMs;
    const warnAt = Math.round(budget * thresholds.responseTime.warnRatio);
    const extras = { expected: `<= ${budget}ms`, actual: `${primary.durationMs}ms` };
    if (primary.durationMs > budget)
      return outcome.failed(`${primary.durationMs}ms exceeds budget ${budget}ms`, extras);
    if (primary.durationMs > warnAt)
      return outcome.warning(
        `${primary.durationMs}ms is above ${warnAt}ms (warning level)`,
        extras,
      );
    return outcome.passed(`${primary.durationMs}ms (budget ${budget}ms)`, extras);
  },
});
