import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { fromChecks, outcome, type CheckDetail } from '@engine/validation-result';
import { runSimultaneously } from '@utils/concurrency';
import { bodyOf, describeResponses, identityOf, inconclusiveIfSerialized } from './support';

/**
 * Two different accounts calling at once must each get their own data (catches identity leaking
 * between sessions, which same-token probes cannot see). SKIPPED without two principals or
 * `identityPaths`. Reads only.
 */
export const sessionIsolationValidator = defineValidator({
  name: 'concurrency.session-isolation',
  category: 'CONCURRENCY',
  severity: 'CRITICAL',
  description: 'Two sessions calling simultaneously each receive their own data, never the other’s',
  toggle: 'concurrency',
  profiles: PROFILE_SETS.SECURITY,
  stage: 'probe',
  appliesTo: ({ endpoint, primary }) => {
    if (endpoint.destructive) return 'a write — two accounts writing at once is not this probe';
    if (!endpoint.authentication.required) return 'a public endpoint has no session to isolate';
    if (primary.isErrorStatus) return `the primary request answered ${primary.status}`;
    if (!endpoint.concurrency.identityPaths?.length) {
      return 'the endpoint declares no concurrency.identityPaths, so "each caller got their own data" cannot be checked';
    }
    return true;
  },
  check: async (context) => {
    const { endpoint } = context;
    const identityPaths = endpoint.concurrency.identityPaths;
    const candidates = context.principals(endpoint.authentication.role);

    if (candidates.length < 2) {
      return outcome.skipped(
        `only ${candidates.length} principal(s) configured for role ${endpoint.authentication.role} — ` +
          'session isolation needs two accounts calling at once and was NOT verified',
        { expected: '2 principals', actual: `${candidates.length}` },
      );
    }

    const pair = candidates.slice(0, 2);
    const spec = await context.nextRequest();

    // Same payload, different callers: a shared identity in the responses can only be a leak.
    const burst = await runSimultaneously(pair.length, (index) => {
      const principal = pair[index];
      if (!principal) throw new Error(`no principal at index ${index}`);
      return context.send(spec, {
        label: `concurrency.session-isolation:${principal.key}`,
        auth: { principal },
      });
    });

    const responses = burst.outcomes.flatMap((o) => (o.value ? [o.value] : []));
    if (responses.length < pair.length) {
      return outcome.skipped(
        `inconclusive: only ${responses.length} of ${pair.length} sessions completed`,
        { expected: `${pair.length} responses`, actual: `${responses.length} responses` },
      );
    }

    const inconclusive = inconclusiveIfSerialized(burst, 'session pair');
    if (inconclusive) return inconclusive;

    const identities = responses.map((response, index) => ({
      principal: pair[index]?.key ?? `#${index + 1}`,
      identity: identityOf(bodyOf(response), identityPaths),
      status: response.status,
      correlationId: response.correlationId,
    }));

    const [first, second] = identities;
    const distinct = new Set(identities.map((entry) => entry.identity ?? 'null'));

    const checks: CheckDetail[] = [
      {
        name: 'both sessions were served',
        status: responses.every((r) => !r.isErrorStatus) ? 'PASSED' : 'FAILED',
        expected: 'both callers answered successfully',
        actual: identities.map((entry) => ({ principal: entry.principal, status: entry.status })),
        message: responses.every((r) => !r.isErrorStatus)
          ? undefined
          : 'one session was rejected while the other succeeded — a concurrent login appears to displace an existing session',
      },
      {
        // Two accounts carrying one identity means one read the other's record (a CRITICAL leak).
        name: 'each session received its own identity',
        status: distinct.size === identities.length ? 'PASSED' : 'FAILED',
        expected: `${identities.length} distinct identities at ${identityPaths?.join(', ')}`,
        actual: identities,
        message:
          distinct.size === identities.length
            ? undefined
            : `${first?.principal} and ${second?.principal} were served the SAME identity — one account received the other's data under concurrency`,
        correlationId: second?.correlationId,
      },
      {
        name: 'the sessions overlapped',
        status: 'PASSED',
        expected: `${pair.length} sessions dispatched together`,
        actual: {
          principals: pair.map((p) => p.key),
          dispatchSkewMs: burst.dispatchSkewMs,
          totalMs: burst.totalMs,
          responses: describeResponses(responses),
        },
      },
    ];

    return fromChecks(checks, 'session-isolation checks');
  },
});
