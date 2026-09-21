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
  /**
   * Simultaneous-request probes. Deliberately small: these exist to expose a race, not to load-test.
   * Eight parallel callers is enough to catch a missing lock, a shared mutable handler field or a
   * connection-pool bleed, while staying well under any sane rate limit — a burst that trips
   * throttling teaches nothing about locking, because the second write never reaches the handler.
   */
  concurrency: {
    /** Requests dispatched together when the endpoint does not say otherwise. */
    defaultRequests: 8,
    /** Hard cap, whatever an endpoint configures. */
    maxRequests: 25,
    /**
     * Largest spread between first and last dispatch that still counts as simultaneous. Above it
     * the burst degraded into a sequence and its result is reported INCONCLUSIVE rather than
     * PASSED — a race that never had the chance to happen is not evidence that it cannot.
     */
    maxDispatchSkewMs: 150,
  },
  /**
   * How many times a FAILED check is re-run before it is believed (`src/validation-engine/
   * reproduction-gate.ts`). Only probes that issue fresh work are retried; a deterministic check
   * cannot disagree with itself, and retrying it would be pure traffic.
   *
   * Three passes is the point of diminishing returns: one flake is common, two in a row is rare
   * enough that a third pass changes the verdict on almost nothing while tripling the cost.
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
