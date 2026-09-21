import {
  assessIndependence,
  describe,
  independenceStrength,
  type IndependenceVerdict,
  type ObservationChannel,
} from './channel';

/**
 * The confirmation stage (master plan §13) — a SEPARATE step from detection.
 *
 * Detection asks "did a check fail?". Confirmation asks a different question:
 *
 *     is the behaviour still there when observed by someone else, somewhere else?
 *
 * Keeping them apart is the point. A detection that also confirms itself has no way to tell a
 * product defect from a bench mistake, because the same code produced both answers.
 *
 * ## What this module is, and is not
 *
 * It is pure. It performs no observation — a spec makes the observations and hands in what it saw,
 * exactly as the state-transition and side-effect layers work. That keeps every safety control in
 * one place: a confirmation that wanted to repeat a write would go through `EndpointExecutor.send`
 * like anything else, so the production guard, the kill-switch and the QA-identifier guard apply to
 * it unchanged, and this module cannot bypass them because it cannot send anything.
 *
 * It decides nothing about Bugzilla. A confirmation is an input to the confidence gate and to the
 * canonical-defect work, never a substitute for them.
 */

export const CONFIRMATION_OUTCOMES = [
  /** Independently observed again, through a path that shares little with the detection. */
  'CONFIRMED',
  /** The independent observation did NOT show the behaviour. The detection is in doubt. */
  'NOT_REPRODUCED',
  /** No independent observation was possible, or it could not be read. Never a synonym for either. */
  'INDETERMINATE',
] as const;
export type ConfirmationOutcome = (typeof CONFIRMATION_OUTCOMES)[number];

/** What the independent observation was asked, and what it saw. */
export interface ConfirmingObservation {
  readonly channel: ObservationChannel;
  /**
   * Whether the independent path showed the SAME behaviour the detection reported.
   *
   * `undefined` when the observation could not be made or could not be read — which is
   * INDETERMINATE, and never quietly treated as "it did not happen".
   */
  readonly showsSameBehaviour: boolean | undefined;
  /** One sentence naming what was actually looked at. */
  readonly evidence: string;
  readonly correlationIds?: readonly string[];
}

export interface ConfirmationRequest {
  /** The exact resource under confirmation — an id, never a subject line or a description. */
  readonly resourceKind: string;
  readonly resourceId: string;
  /** The channel that DETECTED the behaviour. */
  readonly detectedVia: ObservationChannel;
  readonly confirming: ConfirmingObservation;
}

export interface ConfirmationRecord {
  readonly outcome: ConfirmationOutcome;
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly independence: IndependenceVerdict;
  readonly independenceStrength: ReturnType<typeof independenceStrength>;
  readonly reason: string;
  readonly evidence: string;
  readonly correlationIds: readonly string[];
}

/**
 * Whether an independently-observed behaviour is confirmed.
 *
 * Pure, and deterministic for the same inputs.
 *
 * The order of the checks is the whole design. Independence is decided FIRST, so a same-path
 * observation can never reach the outcome — however emphatically it agrees. An observation that
 * merely agrees with itself is the failure mode this stage exists to make impossible, not a weaker
 * kind of evidence to be weighed.
 */
export function confirm(request: ConfirmationRequest): ConfirmationRecord {
  const independence = assessIndependence(request.detectedVia, request.confirming.channel);
  const base = {
    resourceKind: request.resourceKind,
    resourceId: request.resourceId,
    independence,
    independenceStrength: independenceStrength(independence),
    evidence: request.confirming.evidence,
    correlationIds: request.confirming.correlationIds ?? [],
  };

  if (!independence.independent) {
    return {
      ...base,
      outcome: 'INDETERMINATE',
      reason: `Not an independent confirmation. ${independence.reason}`,
    };
  }

  if (request.confirming.showsSameBehaviour === undefined) {
    return {
      ...base,
      outcome: 'INDETERMINATE',
      reason:
        `The independent observation (${describe(request.confirming.channel)}) could not be read, ` +
        `so it neither confirms nor contradicts the detection. ${request.confirming.evidence}`,
    };
  }

  return request.confirming.showsSameBehaviour
    ? {
        ...base,
        outcome: 'CONFIRMED',
        reason:
          `${request.resourceKind} ${request.resourceId} shows the same behaviour when observed ` +
          `independently. ${independence.reason}`,
      }
    : {
        ...base,
        outcome: 'NOT_REPRODUCED',
        reason:
          `${request.resourceKind} ${request.resourceId} did NOT show the behaviour through an ` +
          `independent path. ${independence.reason} The detection is in doubt and must not be ` +
          'reported as a defect on the strength of the original observation alone.',
      };
}

/** One line per record, for a report or an attachment. Carries ids and pool keys, never a secret. */
export function summariseConfirmations(records: readonly ConfirmationRecord[]): string[] {
  return records.map(
    (record) =>
      `${record.outcome.padEnd(15)} [${record.independenceStrength}] ` +
      `${record.resourceKind} ${record.resourceId} — ${record.reason}`,
  );
}
