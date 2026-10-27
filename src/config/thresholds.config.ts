import type { HttpMethod } from '@api/client/request-builder';
import type { Severity } from '@engine/validation-result';

/**
 * Every numeric limit the validators use; endpoints may override via `performance`. Response times
 * are per-request budgets, not load tests.
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
  /** Simultaneous-request probes: small enough to expose a race without tripping a rate limit. */
  concurrency: {
    /** Requests dispatched together when the endpoint does not say otherwise. */
    defaultRequests: 8,
    /** Hard cap, whatever an endpoint configures. */
    maxRequests: 25,
    /**
     * Largest dispatch spread that still counts as simultaneous; above it the result is
     * INCONCLUSIVE.
     */
    maxDispatchSkewMs: 150,
  },
  /**
   * How many times a FAILED probe is re-run before it is believed (reproduction-gate.ts);
   * deterministic checks are not retried.
   */
  reproduction: {
    attempts: 3,
    baseDelayMs: 500,
    /** Ceiling on one backoff, so a slow endpoint cannot stall the whole run on one check. */
    maxDelayMs: 4_000,
  },
  clockSkewMs: 5 * 60_000,
  qualityGate: {
    /** FAILED results of these severities fail the test. Lower severities are reported only. */
    failOnSeverities: ['CRITICAL', 'HIGH', 'MEDIUM'] as readonly Severity[],
  },
} as const;
