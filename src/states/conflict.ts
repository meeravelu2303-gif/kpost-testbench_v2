import type { StateResourceId } from './vocabulary';

/**
 * StateConflict — a disagreement between sources, preserved rather than settled.
 *
 * Phase 4B. The repository contains several genuine contradictions about application state, and the
 * damaging thing is not the contradiction: it is a model that quietly picks one side, after which the
 * disagreement is invisible and the bench asserts against a guess.
 *
 * So a conflict is a first-class record holding **every** position with its citation, and the model
 * exposes no way to mark one correct. This mirrors Phase 1's `RequirementConflict`, which records
 * documentation conflicts without choosing a winner, and is why `STATE_CONFLICT_STATUSES` has exactly
 * one member (below).
 */

/**
 * Deliberately a single-member set.
 *
 * There is no `RESOLVED`, because resolving one of these is not an editorial act — each needs new
 * evidence (a gated live observation, or a statement from the API owner), and producing that evidence
 * is a later phase's work. When a conflict is genuinely settled the record should be removed and the
 * winning claim promoted into a `StateDefinition` with `OBSERVED` provenance, which leaves an
 * auditable trail. A `RESOLVED` flag would instead let a conflict be dismissed by editing a field.
 */
export const STATE_CONFLICT_STATUSES = ['UNRESOLVED'] as const;
export type StateConflictStatus = (typeof STATE_CONFLICT_STATUSES)[number];

/** What kind of disagreement it is. */
export const STATE_CONFLICT_KINDS = [
  /** Two sources use different words for what appears to be one thing. */
  'TERMINOLOGY',
  /** One value documented in two incompatible shapes (a code vs a label; two field names). */
  'REPRESENTATION',
  /** Sources disagree about whether a transition actually occurs. */
  'TRANSITION_CLAIM',
  /** Sources disagree about what a field means. */
  'FIELD_MEANING',
  /** Sources disagree about whether something is covered or in scope. */
  'COVERAGE_CLAIM',
] as const;
export type StateConflictKind = (typeof STATE_CONFLICT_KINDS)[number];

/** One side of a disagreement. Both sides are recorded in full; neither is summarised away. */
export interface ConflictPosition {
  /** The claim in its own terms. */
  readonly claim: string;
  /** Where it is made — a path with a line, or a named document section. */
  readonly citation: string;
}

export interface StateConflict {
  readonly conflictId: string;
  /** The resource it concerns, or `null` when it spans resources (e.g. the BR-X01 parity claim). */
  readonly resource: StateResourceId | null;
  readonly kind: StateConflictKind;
  /** One line naming what is in dispute. */
  readonly subject: string;
  /** At least two, by construction — one position is not a conflict. */
  readonly positions: readonly ConflictPosition[];
  /**
   * Evidence that narrows the question without settling it. Recorded separately from `positions` so
   * a supporting fact can never be mistaken for a verdict.
   */
  readonly additionalEvidence?: readonly ConflictPosition[];
  /** What it would take to settle this — so the next phase knows what to go and measure. */
  readonly resolutionRequires: string;
  readonly status: StateConflictStatus;
}
