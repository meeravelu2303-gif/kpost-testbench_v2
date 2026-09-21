import { state, type StateDefinition, type StateTransition } from '../states/index';
import type { StateObservation } from '../state-observation/index';

/**
 * State transition validation (master plan §9) — did the declared change actually happen?
 *
 *     BEFORE  ──►  ACTION  ──►  AFTER
 *
 * ## The one thing this layer adds
 *
 * Phase 4C observes: it records what a field held, with no expectation and no verdict. Phase 4B
 * declares: it records that documentation describes a change from one state to another. Neither can
 * say whether a change OCCURRED, because that needs two observations and a declaration together.
 * This compares them, and stops there.
 *
 * ## What it deliberately does NOT produce
 *
 * No pass, no fail, no severity, no failure class, no defect and no confidence. The outcome is
 * `OCCURRED | NOT_OCCURRED | INDETERMINATE`, and a spec is what turns that into an assertion. The
 * distinction matters most for the third value: a transition whose before-state was never observed
 * is **not** a failed transition, and reporting it as one is how a bench invents defects out of
 * missing evidence.
 *
 * ## Why comparison is by the raw value, as a string
 *
 * The state model declares `rawValue: '2'` because the types contract is JSON-keyed; a live response
 * returns `2`, a number. Comparing `String(observed) === declared` is the honest reconciliation of
 * those two representations, and it is done HERE rather than by normalising the observation —
 * Phase 4C's rule is that an observed value is never coerced, and that rule is worth more than the
 * convenience of comparing numbers.
 */

export const TRANSITION_OUTCOMES = [
  /** The resource was in the FROM state and is now in the TO state. */
  'OCCURRED',
  /** The resource was in the FROM state and is not in the TO state. */
  'NOT_OCCURRED',
  /**
   * The evidence does not support an answer — the before or after state was not observed, the
   * resource was not in the declared FROM state to begin with, or the model does not define a state
   * the transition names. Never a synonym for failure.
   */
  'INDETERMINATE',
] as const;
export type TransitionOutcome = (typeof TRANSITION_OUTCOMES)[number];

/** What was observed about ONE resource, before and after the action. */
export interface TransitionEvidence {
  /** The resource instance the transition is claimed about — a msgID, a kallID, a transactionID. */
  readonly resourceId: string;
  readonly before: readonly StateObservation[];
  readonly after: readonly StateObservation[];
}

export interface TransitionCheck {
  readonly transitionId: string;
  readonly resourceId: string;
  readonly outcome: TransitionOutcome;
  /** Why, in terms a reader can check against the observations. Never a verdict. */
  readonly reason: string;
  /** The raw value observed on the transition's field before the action, when it was observed. */
  readonly observedBefore?: unknown;
  readonly observedAfter?: unknown;
  /** The state ids the model says those values correspond to, when it says anything. */
  readonly matchedBefore?: readonly string[];
  readonly matchedAfter?: readonly string[];
  /** Correlation ids of the exchanges the observations came from, so evidence stays traceable. */
  readonly correlationIds: readonly string[];
}

/**
 * The observation for a transition's field, on a given resource.
 *
 * Identity is required: an observation with no `resourceId` is explicitly unattributed (Phase 4C
 * records `identityPresence: ABSENT` rather than guessing), and attributing it here would undo that
 * care. The LAST matching observation wins, because a later read of the same field in the same set
 * is a more recent statement about the resource.
 */
function observationFor(
  observations: readonly StateObservation[],
  resourceId: string,
  field: string,
): StateObservation | undefined {
  return observations
    .filter((entry) => entry.resourceId === resourceId && entry.stateKey === field)
    .at(-1);
}

/**
 * Whether an observed raw value corresponds to a declared state value.
 *
 * Only a PRIMITIVE can: a state is declared as a code (`'2'`, `'Y'`), and an object or array in
 * that field is not a value the model describes at all. Stringifying one would compare
 * `"[object Object]"` against a code and could only ever be wrong — so a non-primitive is simply
 * not a match, and the caller reports what was actually seen.
 */
function sameValue(observed: unknown, declared: string): boolean {
  const kind = typeof observed;
  if (kind !== 'string' && kind !== 'number' && kind !== 'boolean' && kind !== 'bigint') {
    return false;
  }
  return String(observed) === declared;
}

/**
 * Whether the declared transition is supported by the observed before/after pair.
 *
 * Pure: it sends nothing, reads no registry beyond the declarative state model, and returns the same
 * answer for the same inputs.
 */
export function checkTransition(
  transition: StateTransition,
  evidence: TransitionEvidence,
): TransitionCheck {
  const base = {
    transitionId: transition.transitionId,
    resourceId: evidence.resourceId,
    correlationIds: [...evidence.before, ...evidence.after]
      .map((entry) => entry.correlationId)
      .filter((id, index, all) => all.indexOf(id) === index),
  };
  const indeterminate = (
    reason: string,
    extra: Partial<TransitionCheck> = {},
  ): TransitionCheck => ({
    ...base,
    outcome: 'INDETERMINATE',
    reason,
    ...extra,
  });

  const toState: StateDefinition | undefined = state(transition.to);
  if (!toState) {
    return indeterminate(
      `the state model defines no state "${transition.to}", so there is nothing to compare an ` +
        'observation against. This is a model gap, not an application result.',
    );
  }
  const fromState = transition.from === null ? undefined : state(transition.from);
  if (transition.from !== null && !fromState) {
    return indeterminate(
      `the state model defines no state "${transition.from}", so the precondition cannot be checked.`,
    );
  }

  /*
   * The FROM and TO states must be observable on the same field, or "before" and "after" are
   * statements about different things. The model allows a transition across fields in principle;
   * this refuses to guess how to compare one, rather than comparing the wrong pair.
   */
  if (fromState && fromState.field !== toState.field) {
    return indeterminate(
      `"${transition.from}" is observed on "${fromState.field}" and "${transition.to}" on ` +
        `"${toState.field}". A cross-field transition needs its own comparison, and guessing one ` +
        'would compare two different facts.',
    );
  }

  const field = toState.field;
  const before = observationFor(evidence.before, evidence.resourceId, field);
  const after = observationFor(evidence.after, evidence.resourceId, field);

  if (!after) {
    return indeterminate(
      `"${field}" was not observed for ${evidence.resourceId} AFTER the action, so whether the ` +
        'transition happened is unknown — which is not the same as it not happening.',
      before ? { observedBefore: before.rawValue, matchedBefore: before.matchedStateIds } : {},
    );
  }
  const observedAfter = { observedAfter: after.rawValue, matchedAfter: after.matchedStateIds };

  if (transition.from !== null) {
    if (!before) {
      return indeterminate(
        `"${field}" was not observed for ${evidence.resourceId} BEFORE the action, so the change ` +
          'cannot be attributed to it.',
        observedAfter,
      );
    }
    if (fromState && !sameValue(before.rawValue, fromState.rawValue)) {
      return indeterminate(
        `${evidence.resourceId} was not in "${transition.from}" before the action — "${field}" ` +
          `held ${JSON.stringify(before.rawValue)}, and the state declares ` +
          `${JSON.stringify(fromState.rawValue)}. The precondition was not met, so the transition ` +
          'was never eligible to occur.',
        {
          observedBefore: before.rawValue,
          matchedBefore: before.matchedStateIds,
          ...observedAfter,
        },
      );
    }
  }

  const withBoth = {
    ...(before ? { observedBefore: before.rawValue, matchedBefore: before.matchedStateIds } : {}),
    ...observedAfter,
  };

  if (sameValue(after.rawValue, toState.rawValue)) {
    return {
      ...base,
      outcome: 'OCCURRED',
      reason:
        `"${field}" moved to ${JSON.stringify(after.rawValue)}, which the model declares as ` +
        `"${transition.to}" (${toState.term}).`,
      ...withBoth,
    };
  }

  if (before && after.rawValue === before.rawValue) {
    return {
      ...base,
      outcome: 'NOT_OCCURRED',
      reason:
        `"${field}" is unchanged at ${JSON.stringify(after.rawValue)}; the model declares ` +
        `"${transition.to}" as ${JSON.stringify(toState.rawValue)}.`,
      ...withBoth,
    };
  }

  return {
    ...base,
    outcome: 'NOT_OCCURRED',
    reason:
      `"${field}" changed to ${JSON.stringify(after.rawValue)}, which is neither the declared ` +
      `"${transition.to}" (${JSON.stringify(toState.rawValue)}) nor its previous value. The ` +
      'resource moved somewhere the transition does not describe.',
    ...withBoth,
  };
}

/** One line per check, for an execution report. Carries values, never a credential. */
export function summariseChecks(checks: readonly TransitionCheck[]): string[] {
  return checks.map(
    (check) =>
      `${check.outcome.padEnd(14)} ${check.transitionId} [${check.resourceId}] — ${check.reason}`,
  );
}
