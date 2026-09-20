import type { ExchangeEvidence } from './evidence';

/**
 * What evidence there is that the APPLICATION actually handled an exchange for this endpoint.
 *
 * ## Why a separate concept from origin
 *
 * Attributing one response answers "who produced THIS?". It does not answer "was the application
 * reachable at all while this test ran?" — and that second question is what separates an
 * intermittent failure in front of the application from a real one inside it.
 *
 * The witness is deliberately NOT a status-code heuristic. `status !== 502` witnesses nothing: a
 * gateway can answer 200 from a cache, and an application can answer 502 of its own. The witness is
 * an actual application-attributed exchange, identified by marker, with its correlation ids kept so
 * the claim can be checked rather than trusted.
 *
 * ## Scope
 *
 * Endpoint-scoped and run-scoped: the witness for `POST /v2/katchup/...` is drawn from the exchanges
 * made to that endpoint during that test. The engine already sends a PRIMARY exchange before any
 * probe, so in practice the primary is the witness and it costs nothing extra to establish.
 */

export type ReachabilityState = 'PRESENT' | 'ABSENT' | 'UNKNOWN';

export interface ReachabilityWitness {
  state: ReachabilityState;
  /** Why the state is what it is — recorded, so the conclusion is auditable. */
  reason: string;
  /** Correlation ids of the exchanges that witnessed the application. */
  witnesses: readonly string[];
  /** How many exchanges were considered, so `UNKNOWN` from an empty set is distinguishable. */
  considered: number;
}

/**
 * The witness for one endpoint, from the exchanges observed for it.
 *
 *  - **PRESENT** — at least one exchange was attributed `APPLICATION`. The application demonstrably
 *    handled a request here, so a *different* exchange that failed without an application marker is
 *    a meaningful contrast for the classifier.
 *  - **ABSENT** — exchanges were made and NONE reached the application: every one was `NO_RESPONSE`
 *    or `EDGE`. Nothing about the application's behaviour can be concluded from them.
 *  - **UNKNOWN** — no exchanges, or the only non-application evidence is itself `UNKNOWN` origin, so
 *    there is nothing to conclude in either direction.
 *
 * Note the asymmetry, and it is deliberate: `ABSENT` is a positive claim ("we looked and the
 * application never answered"), so it requires every exchange to be attributed. A single `UNKNOWN`
 * exchange is enough to make the whole witness `UNKNOWN`, because an unattributed response might
 * well have been the application's.
 */
export function reachabilityOf(evidence: readonly ExchangeEvidence[]): ReachabilityWitness {
  const considered = evidence.length;
  if (considered === 0) {
    return {
      state: 'UNKNOWN',
      reason: 'no exchanges were observed for this endpoint',
      witnesses: [],
      considered,
    };
  }

  const application = evidence.filter((e) => e.origin === 'APPLICATION');
  if (application.length > 0) {
    return {
      state: 'PRESENT',
      reason:
        `${application.length} of ${considered} exchange(s) carried an application marker ` +
        `(${[...new Set(application.map((e) => e.originRule))].join(', ')})`,
      witnesses: application.map((e) => e.correlationId),
      considered,
    };
  }

  const unattributed = evidence.filter((e) => e.origin === 'UNKNOWN');
  if (unattributed.length === 0) {
    return {
      state: 'ABSENT',
      reason:
        `all ${considered} exchange(s) were attributed away from the application ` +
        `(${[...new Set(evidence.map((e) => e.origin))].join(', ')}), so none reached it`,
      witnesses: [],
      considered,
    };
  }

  return {
    state: 'UNKNOWN',
    reason:
      `no exchange carried an application marker, but ${unattributed.length} of ${considered} ` +
      'could not be attributed at all — an unattributed response may still have been the application',
    witnesses: [],
    considered,
  };
}

/** Groups evidence by endpoint, so each endpoint's witness is drawn only from its own exchanges. */
export function reachabilityByEndpoint(
  evidence: readonly ExchangeEvidence[],
): Map<string, ReachabilityWitness> {
  const byEndpoint = new Map<string, ExchangeEvidence[]>();
  for (const record of evidence) {
    const bucket = byEndpoint.get(record.endpointId) ?? [];
    bucket.push(record);
    byEndpoint.set(record.endpointId, bucket);
  }
  return new Map([...byEndpoint].map(([id, records]) => [id, reachabilityOf(records)]));
}
