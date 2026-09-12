import type { HttpMethod } from '@api/client/request-builder';
import type { Severity } from '@engine/validation-result';

/**
 * Every numeric limit used by validators lives here. Endpoints may override per endpoint
 * (`performance`), tests never hard-code them.
 *
 * Response-time checks are functional, per-request budgets — NOT load/performance testing.
 * Keep load tests (k6, Artillery, ...) in a separate suite.
 */
export const thresholds = {
  responseTime: {
    defaultMaxMs: 1_000,
    maxMsByMethod: { GET: 800, POST: 1_500, PUT: 1_500, PATCH: 1_500, DELETE: 1_000 } as Record<
      HttpMethod,
      number
    >,
    /** Above this share of the budget the result is a WARNING instead of PASSED. */
    warnRatio: 0.8,
  },
  requestTimeoutMs: 10_000,
  payload: { maxResponseBytes: 1_048_576 },
  request: {
    /** Upper bound of negative cases one request validator sends per endpoint. */
    maxCasesPerValidator: 20,
  },
  security: {
    maxInjectionFields: 3,
    /** Safety cap for rate-limit probes regardless of endpoint configuration. */
    maxRateLimitBurst: 50,
  },
  clockSkewMs: 5 * 60_000,
  qualityGate: {
    /** FAILED results of these severities fail the test. Lower severities are reported only. */
    failOnSeverities: ['CRITICAL', 'HIGH', 'MEDIUM'] as readonly Severity[],
  },
} as const;
