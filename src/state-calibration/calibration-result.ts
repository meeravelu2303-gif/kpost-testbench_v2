import type { ActorRoleId } from '../actors/index';
import type { StateObservation } from '../state-observation/index';

/**
 * Calibration result types — what controlled LIVE observation established about the State Model.
 *
 * Phase 4D. Calibration answers *"what does the real application expose?"*. It never answers *"is
 * that behaviour correct?"* — that is the future Business Invariant Model's question, and nothing
 * here may anticipate it.
 *
 * ## The verdict vocabulary, and what is deliberately missing from it
 *
 * There is no `PASS`, no `FAIL`, no `BUG`, no severity and no confidence score. A calibration run
 * that observes something unexpected has not failed: it has learned something, and the finding
 * records it. Framework guards assert those words never appear.
 */

export const CALIBRATION_VERDICTS = [
  /** A value was seen. States the fact and nothing more. */
  'OBSERVED',
  /**
   * The live evidence establishes how the application actually represents something — the strongest
   * verdict available, and only usable when the observations rule out the alternatives.
   */
  'CONFIRMED_REPRESENTATION',
  /** The observations do not settle the question. `whatWouldResolve` says what would. */
  'UNKNOWN',
  /** Live evidence contradicts a documented claim, or two observations contradict each other. */
  'CONFLICTED',
] as const;
export type CalibrationVerdict = (typeof CALIBRATION_VERDICTS)[number];

/**
 * One observation, tagged with the step of the scenario that produced it.
 *
 * The phase is what makes a before/after comparison possible at all: two observations of the same
 * field on the same resource are only meaningful once it is known which came before the action.
 */
export interface CalibrationRecord {
  /** The scenario step, e.g. `sender:before-read`. Free-form but stable within a scenario. */
  readonly phase: string;
  /** Whose session made the call, when the caller knew it. Never inferred from the response. */
  readonly actorRole?: ActorRoleId;
  readonly observation: StateObservation;
}

/**
 * One thing the calibration established (or failed to).
 *
 * `evidence` cites the exact observations behind the statement, so a reviewer can check the claim
 * rather than trust it. `statement` describes only what those observations support.
 */
export interface CalibrationFinding {
  /** What the finding is about, e.g. `katchup.message.read-perspective`. */
  readonly subject: string;
  readonly verdict: CalibrationVerdict;
  /** What the evidence establishes, in plain terms. Never a rule, never a judgement. */
  readonly statement: string;
  /** The observations the statement rests on. */
  readonly evidence: readonly CalibrationRecord[];
  /** Any limit on the claim — what it does NOT establish. */
  readonly limitation?: string;
  /** For UNKNOWN: the additional observation that would settle it. */
  readonly whatWouldResolve?: string;
  /** Existing State Model conflict ids this finding bears on, without resolving them. */
  readonly bearsOnConflicts?: readonly string[];
}

/** A cleanup outcome, reported separately from observations so a tidy-up problem never reads as one. */
export interface CalibrationCleanupRecord {
  readonly kind: string;
  readonly id: string;
  readonly outcome: 'CLEANED' | 'CLEANUP_FAILED' | 'NOT_ATTEMPTED';
  readonly detail?: string;
}

/**
 * What the observation ATTEMPT looked like, independent of what it found.
 *
 * Without this, a result with zero observations is ambiguous in a way that matters: "the account had
 * no calls today" and "the declared field path does not match this build's response" produce exactly
 * the same empty record set, and only the second is a defect in the State Model. This records enough
 * of the attempt to tell them apart — the HTTP status, whether the expected envelope key was there,
 * and how many rows the path reached — without copying the response.
 */
export interface CalibrationAttempt {
  readonly endpointId: string;
  readonly observationId: string;
  readonly httpStatus: number;
  /** Whether the body parsed as JSON at all. */
  readonly parsed: boolean;
  /** Top-level key NAMES only — never values. Enough to see a shape mismatch. */
  readonly envelopeKeys: readonly string[];
  /** How many observations the path produced. Zero with a healthy envelope means "no rows". */
  readonly observationCount: number;
}

/** The whole result of one calibration scenario. Serialisable, and free of response bodies. */
export interface CalibrationResult {
  readonly scenarioId: string;
  readonly runId?: string;
  readonly startedAt: string;
  readonly records: readonly CalibrationRecord[];
  readonly findings: readonly CalibrationFinding[];
  readonly attempts: readonly CalibrationAttempt[];
  readonly cleanup: readonly CalibrationCleanupRecord[];
}

/** Words a calibration finding must never carry. Asserted by a framework guard. */
export const FORBIDDEN_CALIBRATION_TERMS = [
  'PASS',
  'FAIL',
  'BUG',
  'DEFECT',
  'FailureClass',
  'confidence',
  'severity',
] as const;
