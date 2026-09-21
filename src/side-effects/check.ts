/**
 * Side-effect verification (master plan §11) — did the DERIVED value change as it must?
 *
 *     BEFORE  ──►  ACTION  ──►  AFTER   …  and the DELTA between them
 *
 * ## Why this is not state-transition validation
 *
 * Phase 7 asks whether a RESOURCE reached a declared state: "is this message now read?". A side
 * effect is the consequence somewhere else: the recipient's unread COUNT, the group's member count,
 * the call log gaining an entry. Different question, different evidence, and different failure —
 * a message can be correctly marked read while the unread badge never moves, and only a count
 * comparison finds that.
 *
 * ## The rule that makes a count assertion trustworthy
 *
 * **Assert the DELTA, never the absolute value.** A QA account's inbox is not empty and other tests
 * share it, so "unread is 1 after sending one message" is false in practice and would be repaired by
 * loosening it — which is how a count check degrades into `toBeGreaterThan(0)` and stops meaning
 * anything. Measuring before and after makes the assertion exact AND robust to whatever else is in
 * the account.
 *
 * ## Deliberately absent
 *
 * No pass, no fail, no severity, no failure class, no confidence. `OBSERVED | NOT_OBSERVED |
 * INDETERMINATE`, and a spec turns that into an assertion — the same boundary Phase 7 keeps, and for
 * the same reason: a side effect that could not be MEASURED has not failed.
 */

export const SIDE_EFFECT_OUTCOMES = [
  /** The value changed exactly as the expectation required. */
  'OBSERVED',
  /** The value was measured on both sides and did not change as required. */
  'NOT_OBSERVED',
  /** One side could not be measured, so no comparison is possible. Never a synonym for failure. */
  'INDETERMINATE',
] as const;
export type SideEffectOutcome = (typeof SIDE_EFFECT_OUTCOMES)[number];

/** What must be true of the change. Exactly one of these is used per check. */
export type SideEffectExpectation =
  /** The value must increase by exactly this much (negative for a decrease). */
  | { readonly delta: number }
  /** The value must become exactly this. For a flag, not a count. */
  | { readonly becomes: unknown }
  /** The value must change, without the expectation naming the new one. */
  | { readonly changes: true };

export interface SideEffectEvidence {
  /** What is being counted or flagged, in the application's own terms. */
  readonly name: string;
  /** The value before the action; `undefined` when it could not be measured. */
  readonly before: unknown;
  /** The value after; `undefined` when it could not be measured. */
  readonly after: unknown;
  /** Correlation ids of the exchanges the values came from. */
  readonly correlationIds?: readonly string[];
}

export interface SideEffectCheck {
  readonly name: string;
  readonly outcome: SideEffectOutcome;
  readonly reason: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly correlationIds: readonly string[];
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Whether the observed change satisfies the expectation.
 *
 * Pure: it sends nothing and returns the same answer for the same inputs.
 */
export function checkSideEffect(
  evidence: SideEffectEvidence,
  expectation: SideEffectExpectation,
): SideEffectCheck {
  const base = {
    name: evidence.name,
    before: evidence.before,
    after: evidence.after,
    correlationIds: evidence.correlationIds ?? [],
  };

  if (evidence.before === undefined || evidence.after === undefined) {
    const side = evidence.before === undefined ? 'BEFORE' : 'AFTER';
    return {
      ...base,
      outcome: 'INDETERMINATE',
      reason:
        `"${evidence.name}" could not be measured ${side} the action, so no comparison is ` +
        'possible. Unmeasured is not unchanged.',
    };
  }

  if ('delta' in expectation) {
    if (!isFiniteNumber(evidence.before) || !isFiniteNumber(evidence.after)) {
      return {
        ...base,
        outcome: 'INDETERMINATE',
        reason:
          `"${evidence.name}" was expected to change by ${String(expectation.delta)}, but the ` +
          `observed values are not both numbers (${JSON.stringify(evidence.before)} → ` +
          `${JSON.stringify(evidence.after)}). A delta over a non-number would be invented.`,
      };
    }
    const actual = evidence.after - evidence.before;
    return actual === expectation.delta
      ? {
          ...base,
          outcome: 'OBSERVED',
          reason: `"${evidence.name}" moved ${String(evidence.before)} → ${String(evidence.after)} (${signed(actual)}), as required.`,
        }
      : {
          ...base,
          outcome: 'NOT_OBSERVED',
          reason:
            `"${evidence.name}" moved ${String(evidence.before)} → ${String(evidence.after)} ` +
            `(${signed(actual)}); the expected change was ${signed(expectation.delta)}.`,
        };
  }

  if ('becomes' in expectation) {
    return evidence.after === expectation.becomes
      ? {
          ...base,
          outcome: 'OBSERVED',
          reason: `"${evidence.name}" became ${JSON.stringify(expectation.becomes)}, as required.`,
        }
      : {
          ...base,
          outcome: 'NOT_OBSERVED',
          reason:
            `"${evidence.name}" is ${JSON.stringify(evidence.after)}; the expected value was ` +
            `${JSON.stringify(expectation.becomes)}.`,
        };
  }

  return evidence.after !== evidence.before
    ? {
        ...base,
        outcome: 'OBSERVED',
        reason: `"${evidence.name}" changed ${JSON.stringify(evidence.before)} → ${JSON.stringify(evidence.after)}.`,
      }
    : {
        ...base,
        outcome: 'NOT_OBSERVED',
        reason: `"${evidence.name}" is unchanged at ${JSON.stringify(evidence.after)}.`,
      };
}

function signed(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}

/** One line per check, for a report. Carries values, never a credential. */
export function summariseSideEffects(checks: readonly SideEffectCheck[]): string[] {
  return checks.map((check) => `${check.outcome.padEnd(14)} ${check.name} — ${check.reason}`);
}
