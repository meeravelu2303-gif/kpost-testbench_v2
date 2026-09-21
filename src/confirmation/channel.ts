/**
 * Observation channels, and the rule that makes a confirmation worth having.
 *
 * ## The failure this exists to prevent
 *
 * Re-running a failing assertion is not confirmation. It repeats the same request through the same
 * client, reads the same response with the same parser and applies the same expectation — so it
 * reproduces every mistake the first run could have made, and returns the same answer with more
 * confidence attached. The master plan says it in one line: *do not simply repeat the same
 * assertion.*
 *
 * What removes the doubt is observing the SAME resource through a path that shares as little as
 * possible with the one that detected it:
 *
 *     API action     ──►  UI observation
 *     UI action      ──►  API observation
 *     sender action  ──►  recipient observation
 *     mutation       ──►  read-back through a different endpoint
 *
 * Each of those breaks a different shared assumption. A UI observation does not share the bench's
 * request builder or its response parser. A recipient's observation does not share the sender's
 * session, token or permissions. A different endpoint does not share the first one's handler.
 *
 * ## Independence is structural, not a judgement
 *
 * A channel is a triple — surface, actor and endpoint — and independence is defined on it, so
 * nothing has to decide case by case whether a confirmation "counts". A confirmation attempted down
 * a channel that is not independent of the detection returns INDETERMINATE and says so, rather than
 * being quietly accepted as a second opinion.
 */

/** Where an observation was made. */
export const OBSERVATION_SURFACES = ['API', 'UI'] as const;
export type ObservationSurface = (typeof OBSERVATION_SURFACES)[number];

/**
 * One path to an observation.
 *
 * `actorKey` is the account POOL KEY, never a username and never a credential — the same rule the
 * account pool and the cross-actor reporting keep, and for the same reason: a confirmation record is
 * durable and is read by people who did not run the test.
 */
export interface ObservationChannel {
  readonly surface: ObservationSurface;
  readonly actorKey: string;
  /** The endpoint or screen the observation was made through. */
  readonly via: string;
}

/** Why two channels are, or are not, independent. Always stated, never implied. */
export interface IndependenceVerdict {
  readonly independent: boolean;
  /** Which assumptions the confirmation breaks. Empty when it breaks none. */
  readonly differsBy: readonly ('surface' | 'actor' | 'endpoint')[];
  readonly reason: string;
}

/**
 * Whether `confirming` is an independent path to the same fact as `detecting`.
 *
 * Any ONE of a different surface, a different actor or a different endpoint is enough, because each
 * breaks a distinct shared assumption. Differing in none is the case this function exists to catch:
 * it is the same observation made twice.
 */
export function assessIndependence(
  detecting: ObservationChannel,
  confirming: ObservationChannel,
): IndependenceVerdict {
  const differsBy: ('surface' | 'actor' | 'endpoint')[] = [];
  if (detecting.surface !== confirming.surface) differsBy.push('surface');
  if (detecting.actorKey !== confirming.actorKey) differsBy.push('actor');
  if (detecting.via !== confirming.via) differsBy.push('endpoint');

  if (differsBy.length === 0) {
    return {
      independent: false,
      differsBy,
      reason:
        `The confirming observation uses the same surface (${confirming.surface}), the same actor ` +
        `(${confirming.actorKey}) and the same endpoint (${confirming.via}) as the detection. That ` +
        'is the same assertion run twice, which reproduces any mistake the first one made.',
    };
  }

  return {
    independent: true,
    differsBy,
    reason:
      `The confirming observation differs by ${differsBy.join(' and ')}: ` +
      `${describe(detecting)} → ${describe(confirming)}.`,
  };
}

/** A channel in one readable phrase. Carries a pool key, never a credential. */
export function describe(channel: ObservationChannel): string {
  return `${channel.surface} as ${channel.actorKey} via ${channel.via}`;
}

/**
 * How strongly a set of differences separates the two observations.
 *
 * Deliberately an ordinal label and not a score. A number invites a threshold, a threshold invites
 * tuning it until the queue looks right, and a tuned threshold cannot say WHICH assumption was
 * broken — which is the only thing a reader actually needs.
 */
export function independenceStrength(
  verdict: IndependenceVerdict,
): 'NONE' | 'WEAK' | 'STRONG' | 'STRONGEST' {
  if (!verdict.independent) return 'NONE';
  // A different surface breaks the most: neither the client, the parser nor the session is shared.
  if (verdict.differsBy.includes('surface')) return 'STRONGEST';
  // A different actor breaks the session and the permissions, which no endpoint change can.
  if (verdict.differsBy.includes('actor')) return 'STRONG';
  return 'WEAK';
}
