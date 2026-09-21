import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { fromChecks, outcome, type CheckDetail } from '@engine/validation-result';
import { runSimultaneously } from '@utils/concurrency';
import {
  bodyOf,
  burstSize,
  canonicalBody,
  describeResponses,
  identityOf,
  inconclusiveIfSerialized,
} from './support';

/**
 * The same read, issued by several callers at the same instant, must answer all of them the same
 * way — and must never answer one of them with another caller's record.
 *
 * ## What this catches that a sequential test cannot
 *
 * Every fault below is invisible to a suite that sends one request at a time, because each one
 * needs two requests inside the handler simultaneously:
 *
 *  - **Response bleed.** A pooled HTTP client, a reused buffer or a mis-scoped response object
 *    hands caller A the body built for caller B. The single-caller tests pass forever.
 *  - **Handler state on a shared instance.** A field on a singleton controller (`this.userId`,
 *    a request-scoped value cached at class level) is overwritten by the second request while the
 *    first is still using it — the classic Spring/Express singleton bug.
 *  - **Connection-pool exhaustion.** The eighth simultaneous reader gets a 500 because the pool is
 *    sized for one, while the first seven are served normally.
 *
 * ## Why the three checks carry different weights
 *
 * They are not equally certain, and reporting them at one severity would either bury the serious
 * finding or flood the tracker with noise:
 *
 *  - **status divergence → FAILED.** One caller getting 500 while another gets 200 for the
 *    identical request is a defect under any reading.
 *  - **identity divergence → FAILED.** Responses carrying different `identityPaths` values means
 *    one caller received another's data. Nothing legitimate produces this.
 *  - **body divergence → WARNING.** Genuinely ambiguous: it may be a bleed, or the record may have
 *    changed between two reads a millisecond apart. It is surfaced with both bodies attached for a
 *    human to judge, and deliberately not filed as a defect on its own.
 *
 * Reads only. A burst of writes is a different question with a different answer, and it belongs to
 * `concurrency.duplicate-write`.
 */
export const readConsistencyValidator = defineValidator({
  name: 'concurrency.read-consistency',
  category: 'CONCURRENCY',
  severity: 'HIGH',
  description:
    'Simultaneous identical reads answer every caller the same way, with no cross-caller bleed',
  toggle: 'concurrency',
  profiles: PROFILE_SETS.DEEP_AND_SECURITY,
  stage: 'probe',
  appliesTo: ({ endpoint, primary }) => {
    if (endpoint.destructive) return 'a write — covered by concurrency.duplicate-write';
    /*
     * A primary that already failed makes every comparison meaningless: the burst would agree with
     * it perfectly and report a clean pass on a broken endpoint.
     */
    if (primary.isErrorStatus) return `the primary request answered ${primary.status}`;
    return true;
  },
  check: async (context) => {
    const { endpoint, primary } = context;
    const count = burstSize(endpoint);
    const spec = await context.nextRequest();

    const burst = await runSimultaneously(count, (index) =>
      context.send(spec, { label: `concurrency.read-consistency:#${index + 1}` }),
    );

    const transportFailures = burst.outcomes.filter((o) => o.error);
    if (transportFailures.length === burst.outcomes.length) {
      return outcome.failed(
        `all ${count} simultaneous reads failed to complete: ${transportFailures[0]?.error?.message ?? 'unknown transport error'}`,
        { expected: `${count} responses`, actual: '0 responses' },
      );
    }

    const inconclusive = inconclusiveIfSerialized(burst, 'read burst');
    if (inconclusive) return inconclusive;

    const responses = burst.outcomes.flatMap((o) => (o.value ? [o.value] : []));
    const checks: CheckDetail[] = [];

    // --- Status agreement -----------------------------------------------------------------------
    const statuses = responses.map((r) => r.status);
    const divergentStatus = statuses.filter((status) => status !== primary.status);
    checks.push({
      name: `all ${responses.length} simultaneous reads answered ${primary.status}`,
      status: divergentStatus.length === 0 ? 'PASSED' : 'FAILED',
      expected: primary.status,
      actual: divergentStatus.length === 0 ? primary.status : statuses,
      message:
        divergentStatus.length === 0
          ? undefined
          : `${divergentStatus.length} of ${responses.length} answered differently under load`,
    });

    // --- Caller identity ------------------------------------------------------------------------
    const identityPaths = endpoint.concurrency.identityPaths;
    const primaryIdentity = identityOf(bodyOf(primary), identityPaths);
    if (primaryIdentity === undefined) {
      checks.push({
        name: 'caller identity is unchanged across the burst',
        status: 'SKIPPED',
        message:
          'the endpoint declares no concurrency.identityPaths, so there is no identity to compare',
      });
    } else {
      const foreign = responses
        .map((response, index) => ({
          index,
          identity: identityOf(bodyOf(response), identityPaths),
        }))
        .filter((entry) => entry.identity !== primaryIdentity);
      checks.push({
        name: 'caller identity is unchanged across the burst',
        status: foreign.length === 0 ? 'PASSED' : 'FAILED',
        expected: primaryIdentity,
        actual: foreign.length === 0 ? primaryIdentity : foreign,
        message:
          foreign.length === 0
            ? undefined
            : `${foreign.length} response(s) carried a DIFFERENT caller's identity — one caller was served another's record`,
        correlationId: responses[foreign[0]?.index ?? 0]?.correlationId,
      });
    }

    // --- Body agreement (advisory) --------------------------------------------------------------
    const volatilePaths = endpoint.concurrency.volatilePaths ?? [];
    const primaryBody = canonicalBody(bodyOf(primary), volatilePaths);
    const divergentBodies = responses
      .map((response, index) => ({
        index,
        body: canonicalBody(bodyOf(response), volatilePaths),
        correlationId: response.correlationId,
      }))
      .filter((entry) => entry.body !== primaryBody);
    checks.push({
      name: 'response bodies agree once volatile fields are masked',
      status: divergentBodies.length === 0 ? 'PASSED' : 'WARNING',
      expected: primaryBody.slice(0, 500),
      actual:
        divergentBodies.length === 0
          ? 'identical'
          : divergentBodies.map((entry) => ({
              request: `#${entry.index + 1}`,
              correlationId: entry.correlationId,
              body: entry.body.slice(0, 500),
            })),
      message:
        divergentBodies.length === 0
          ? undefined
          : `${divergentBodies.length} of ${responses.length} bodies differ — either a cross-caller bleed or a record that changed mid-burst; add the moving field to concurrency.volatilePaths if it is expected to change`,
    });

    /*
     * The burst's own telemetry rides along as a passing check rather than as free text: a reader
     * judging an identity divergence needs to see how tightly the requests actually overlapped,
     * and `fromChecks` only carries what the checks carry.
     */
    checks.push({
      name: 'the burst overlapped',
      status: 'PASSED',
      expected: `${count} requests dispatched together`,
      actual: {
        dispatchSkewMs: burst.dispatchSkewMs,
        totalMs: burst.totalMs,
        responses: describeResponses(responses),
      },
    });

    return fromChecks(checks, 'concurrency checks');
  },
});
