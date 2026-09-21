/**
 * What a failure IS — the vocabulary, the reasons, and the shape of an explained decision.
 *
 * Phase 3.3. This module holds only types and constants; the rules live in `classifier.ts` and the
 * durable record in `observation.ts`. Keeping them apart is what lets the rules be a pure function
 * over data that nothing else can reach into.
 *
 * ## The invariant this exists to enforce
 *
 *     FAILED VALIDATION != APPLICATION DEFECT
 *
 * A failed check is an observation. A defect is a conclusion, and a conclusion needs evidence that
 * the APPLICATION produced the behaviour being judged. Nothing here reads a status code on its own,
 * and nothing here reads prose.
 *
 * ## What this phase does NOT do
 *
 * It decides nothing about Bugzilla. Filing eligibility, grouping and confirmation are later phases;
 * a classification is an input to that work, never a substitute for it. Phase 3.3 runs in shadow.
 */

/** The seven classes. Adding one needs approval — this is a closed vocabulary on purpose. */
export const FAILURE_CLASSES = [
  'APP_DEFECT',
  'TEST_ISSUE',
  'ENVIRONMENT',
  'INFRASTRUCTURE',
  'INSUFFICIENT_EVIDENCE',
  'BLOCKED',
  'NOT_IMPLEMENTED',
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/**
 * Why a class was chosen. One code per RULE, so a distribution over reason codes says which rules
 * are actually carrying the classification — and which have never fired against real traffic.
 */
export const REASON_CODES = [
  'CLEANUP_APPLICATION_REFUSED',
  'CLEANUP_NO_RESPONSE',
  'CLEANUP_INTERMEDIARY',
  'CLEANUP_ORIGIN_UNKNOWN',
  /** The validator's own code faulted — a programming error, identified by the error TYPE. */
  'VALIDATOR_IMPLEMENTATION_ERROR',
  /** Something threw, but responsibility could not be established. */
  'VALIDATOR_EXCEPTION_UNATTRIBUTED',
  'PRECONDITION_FAILED',
  'TRANSPORT_FAILURE',
  'NO_RESPONSE_WITHOUT_TRANSPORT_EVIDENCE',
  'INTERMEDIARY_RESPONSE',
  /** The host DECLARED throttling with a Retry-After header — never inferred from a 429 alone. */
  'THROTTLING_DECLARED',
  'ORIGIN_UNKNOWN',
  'NO_DECIDING_EXCHANGE',
  'APPLICATION_REACHABILITY_UNPROVEN',
  'EXPECTATION_CONFLICTS_WITH_CONTRACT',
  /** The endpoint's own configuration declares the capability unsupported. */
  'CAPABILITY_DECLARED_UNSUPPORTED',
  'APPLICATION_CONTRACT_VIOLATION',
  /** A DECLARED prerequisite step of the flow failed, so this step never exercised its subject. */
  'FLOW_PREREQUISITE_FAILED',
  /** The resource did not reach the declared state, and the application produced the evidence. */
  'STATE_TRANSITION_NOT_OBSERVED',
  /** Before or after could not be observed, so no transition judgement is possible. */
  'STATE_TRANSITION_INDETERMINATE',
  /** A derived value did not change as the action required. */
  'SIDE_EFFECT_NOT_OBSERVED',
  /** One side of the comparison was never measured. Unmeasured is not unchanged. */
  'SIDE_EFFECT_INDETERMINATE',
  'UNCLASSIFIED',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * WHICH dimension of the contract a failing check was testing, so `APP_DEFECT` is never a black box.
 *
 * Derived from the validator's own name — the vocabulary the bench already uses
 * (`response.status-code`, `security.security-headers`, `request.null-value`, `business-rule.BR-C01`)
 * — rather than from a new taxonomy invented for this phase. It describes the DIMENSION under test,
 * not a verdict, so it is recorded for every observation and not only for defects.
 *
 * `INPUT_VALIDATION` and `PERFORMANCE` extend the suggested set because `request.*` (11 validators)
 * and `performance.*` (3) are real, sizeable families in this repository that would otherwise
 * collapse into `OTHER` and lose exactly the detail this field exists to provide.
 *
 * ## Phase 10 widening, and why it is safe
 *
 * The master plan asks for authentication/session, authorization, data consistency and UI behaviour
 * to be DISTINGUISHABLE rather than merged. Three of those were collapsing here:
 * `authentication.*` and `authorization.*` both resolved to `SECURITY`, so "the caller was not
 * who they claimed" and "the caller was not allowed to do that" — different defects, different
 * owners, different fixes — were indistinguishable in every report. They are now their own
 * dimensions, and `STATE_TRANSITION`, `SIDE_EFFECT` and `DATA_CONSISTENCY` are added for the
 * Phase 7 and Phase 9 evidence that previously had nowhere to go.
 *
 * Safe for Bugzilla because `violationType` is NOT part of a bug fingerprint — identity is
 * `endpointId | validatorName | message` (`bug-fingerprint.ts`). Refining a dimension therefore
 * cannot orphan an existing ticket or duplicate one, which is exactly the trap the 2026-09-17
 * product-scoped-dedup entry in the decision log records.
 */
export const VIOLATION_TYPES = [
  'STATUS_CODE',
  'RESPONSE_SCHEMA',
  'HEADER',
  'CONTENT_TYPE',
  'SECURITY',
  'AUTHENTICATION',
  'AUTHORIZATION',
  'INPUT_VALIDATION',
  'BUSINESS_RULE',
  'STATE',
  'STATE_TRANSITION',
  'SIDE_EFFECT',
  'DATA_CONSISTENCY',
  'UI_BEHAVIOUR',
  'PERFORMANCE',
  'OTHER',
] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];

/**
 * A named piece of evidence the decision rests on — an identifier or a small scalar, never a body,
 * a header value or anything that could carry a secret. Values are bounded by construction because
 * they are drawn from already-redacted Phase 3.2 evidence.
 */
export interface EvidenceReference {
  field: string;
  value: string | number | boolean;
}

/** Evidence the classifier WANTED and did not have. The reason an answer is weak, stated plainly. */
export type MissingEvidence = string;

export interface ClassificationResult {
  classification: FailureClass;
  reasonCode: ReasonCode;
  /** The contract dimension the failing check was testing. */
  violationType: ViolationType;
  /** One sentence a human can act on. Never contains a response body or a secret. */
  summary: string;
  supportingEvidence: readonly EvidenceReference[];
  missingEvidence: readonly MissingEvidence[];
  /**
   * Whether this observation is worth a later defect review — NOT a Bugzilla decision.
   *
   * True only for `APP_DEFECT`. It is deliberately a separate field from the class so the later
   * confidence gate has somewhere to disagree without rewriting the classification.
   */
  eligibleForDefectReview: boolean;
  /** True when the failure happened while the framework was tearing down. */
  cleanupRelated: boolean;
}

/**
 * Bumped whenever a rule changes meaning, so a stored observation can always be read against the
 * rules that produced it. A distribution is only comparable across runs of the same version.
 */
export const CLASSIFIER_VERSION = '3.4.0';

/**
 * Validator name → the contract dimension it tests. Longest prefix wins, so `security.rate-limit`
 * resolves before the bare `security.` family.
 */
const VIOLATION_BY_PREFIX: readonly (readonly [string, ViolationType])[] = [
  ['response.status-code', 'STATUS_CODE'],
  ['response.content-type', 'CONTENT_TYPE'],
  ['response.headers', 'HEADER'],
  ['response.schema', 'RESPONSE_SCHEMA'],
  ['response.structure', 'RESPONSE_SCHEMA'],
  ['response.error-format', 'RESPONSE_SCHEMA'],
  ['response.metadata', 'RESPONSE_SCHEMA'],
  ['response.pagination', 'RESPONSE_SCHEMA'],
  ['response.time', 'PERFORMANCE'],
  ['security.security-headers', 'HEADER'],
  ['flow.server-error', 'STATUS_CODE'],
  ['business-rule.', 'BUSINESS_RULE'],
  ['performance.', 'PERFORMANCE'],
  ['request.', 'INPUT_VALIDATION'],
  ['common.', 'RESPONSE_SCHEMA'],
  ['security.', 'SECURITY'],
  ['authentication.', 'AUTHENTICATION'],
  ['authorization.', 'AUTHORIZATION'],
  ['database.', 'STATE'],
  ['state-transition.', 'STATE_TRANSITION'],
  ['side-effect.', 'SIDE_EFFECT'],
  ['consistency.', 'DATA_CONSISTENCY'],
  ['ui.', 'UI_BEHAVIOUR'],
];

/** The dimension a validator tests. Deterministic, and `OTHER` when the name is unrecognised. */
export function violationTypeOf(validatorName: string): ViolationType {
  const match = [...VIOLATION_BY_PREFIX]
    .filter(([prefix]) => validatorName === prefix || validatorName.startsWith(prefix))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match ? match[1] : 'OTHER';
}
