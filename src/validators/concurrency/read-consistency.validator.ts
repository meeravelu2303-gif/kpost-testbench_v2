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
 * The same read sent by several callers at once must answer all of them alike, never with another
 * caller's record (catches response bleed, shared handler state, pool exhaustion). Status or
 * identity divergence FAILS; body divergence is only a WARNING, since the record may have changed.
 * Reads only.
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
    // A failed primary makes every comparison meaningless.
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

    // The burst's timing rides along as a passing check, showing how tightly requests overlapped.
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
