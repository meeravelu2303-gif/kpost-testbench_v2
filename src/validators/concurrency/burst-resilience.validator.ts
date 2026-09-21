import { apiConfig } from '@config/api.config';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { fromChecks, outcome, type CheckDetail } from '@engine/validation-result';
import { runSimultaneously } from '@utils/concurrency';
import { burstSize, describeResponses, inconclusiveIfSerialized } from './support';

/**
 * Under a simultaneous burst an endpoint must either serve every caller or throttle the excess —
 * it must not fall over.
 *
 * ## Why this exists next to `security.rate-limit`
 *
 * They look similar and answer opposite questions. `security.rate-limit` sends requests **one after
 * another** and asks "is there a limit, and does it say Retry-After?" — a policy question. This one
 * sends them **at the same instant** and asks "what happens to the ones that arrive together?" — a
 * robustness question. A sequential probe cannot produce the failure this one looks for, because
 * the server never has more than one request in hand.
 *
 * The distinction matters in practice: an endpoint with a correct rate-limit policy can still 500
 * on the third simultaneous caller because its connection pool holds two, and only the parallel
 * burst shows it.
 *
 * ## The verdict
 *
 *  - **5xx → FAILED (HIGH).** Collapsing under eight callers is a defect. Eight is not load; it is
 *    an ordinary afternoon.
 *  - **Throttled without `Retry-After` → WARNING.** The limit works; the client is left guessing
 *    when to retry. Worth reporting, not worth a P1.
 *  - **Everything served, or cleanly throttled → PASSED.**
 *
 * A 4xx that is neither the expected status nor the throttle status is reported as an
 * inconsistency, because the same request answered 2xx a moment earlier as the primary exchange.
 */
export const burstResilienceValidator = defineValidator({
  name: 'concurrency.burst-resilience',
  category: 'CONCURRENCY',
  severity: 'HIGH',
  description: 'A simultaneous burst is served or cleanly throttled — never answered with a 5xx',
  toggle: 'concurrency',
  profiles: PROFILE_SETS.SECURITY,
  stage: 'probe',
  appliesTo: ({ endpoint, primary }) => {
    if (endpoint.destructive)
      return 'a write — a burst of writes belongs to concurrency.duplicate-write';
    if (primary.isErrorStatus) return `the primary request answered ${primary.status}`;
    return true;
  },
  check: async (context) => {
    const { endpoint, primary } = context;
    const count = burstSize(endpoint);
    const spec = await context.nextRequest();

    const burst = await runSimultaneously(count, (index) =>
      context.send(spec, { label: `concurrency.burst-resilience:#${index + 1}` }),
    );

    const responses = burst.outcomes.flatMap((o) => (o.value ? [o.value] : []));
    const transportFailures = burst.outcomes.filter((o) => o.error);
    if (responses.length === 0) {
      return outcome.failed(
        `no response to any of ${count} simultaneous requests: ${transportFailures[0]?.error?.message ?? 'unknown transport error'}`,
        { expected: `${count} responses`, actual: '0 responses' },
      );
    }

    const inconclusive = inconclusiveIfSerialized(burst, 'burst');
    if (inconclusive) return inconclusive;

    const throttleStatus = apiConfig.rateLimitStatus;
    const serverErrors = responses.filter((r) => r.status >= 500);
    const throttled = responses.filter((r) => r.status === throttleStatus);
    const expected = responses.filter((r) => endpoint.expectedStatus.includes(r.status));
    const unexplained = responses.filter(
      (r) =>
        r.status < 500 &&
        r.status !== throttleStatus &&
        !endpoint.expectedStatus.includes(r.status),
    );

    const checks: CheckDetail[] = [
      {
        name: `no server error under ${count} simultaneous callers`,
        status: serverErrors.length === 0 ? 'PASSED' : 'FAILED',
        expected: 'no 5xx',
        actual:
          serverErrors.length === 0
            ? 'none'
            : serverErrors.map((r) => ({ status: r.status, correlationId: r.correlationId })),
        message:
          serverErrors.length === 0
            ? undefined
            : `${serverErrors.length} of ${responses.length} simultaneous callers got a server error — the endpoint breaks under concurrency rather than throttling`,
        correlationId: serverErrors[0]?.correlationId,
      },
      {
        name: 'transport completed for every caller',
        status: transportFailures.length === 0 ? 'PASSED' : 'FAILED',
        expected: `${count} completed`,
        actual: `${responses.length} completed, ${transportFailures.length} dropped`,
        message:
          transportFailures.length === 0
            ? undefined
            : `${transportFailures.length} connection(s) were dropped rather than answered: ${transportFailures[0]?.error?.message ?? ''}`,
      },
      {
        name: 'responses that are neither expected nor a throttle',
        status: unexplained.length === 0 ? 'PASSED' : 'WARNING',
        expected: `${endpoint.expectedStatus.join('/')} or ${throttleStatus}`,
        actual:
          unexplained.length === 0
            ? 'none'
            : unexplained.map((r) => ({ status: r.status, correlationId: r.correlationId })),
        message:
          unexplained.length === 0
            ? undefined
            : `the same request answered ${primary.status} a moment earlier, so these statuses are concurrency-dependent`,
      },
    ];

    if (throttled.length > 0) {
      const missingRetryAfter = throttled.filter((r) => !r.header('retry-after'));
      checks.push({
        name: `throttled callers are told when to retry`,
        status: missingRetryAfter.length === 0 ? 'PASSED' : 'WARNING',
        expected: `Retry-After on every ${throttleStatus}`,
        actual: `${throttled.length - missingRetryAfter.length}/${throttled.length} carried Retry-After`,
        message:
          missingRetryAfter.length === 0
            ? undefined
            : 'a throttled client has no way to know when it may try again, so it will retry immediately and be throttled again',
      });
    }

    checks.push({
      name: 'the burst overlapped',
      status: 'PASSED',
      expected: `${count} requests dispatched together`,
      actual: {
        dispatchSkewMs: burst.dispatchSkewMs,
        totalMs: burst.totalMs,
        served: expected.length,
        throttled: throttled.length,
        responses: describeResponses(responses),
      },
    });

    return fromChecks(checks, 'burst checks');
  },
});
