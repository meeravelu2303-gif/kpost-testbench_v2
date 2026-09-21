/**
 * Whether a classified failure has evidence strong enough to be treated as a defect CANDIDATE.
 *
 * Phase 3.4. Types and constants only; the rules live in `confidence-gate.ts`. Keeping them apart is
 * what lets the rules be a pure function over data nothing else can reach into — the same split
 * Phase 3.3 uses for `classification.ts` / `classifier.ts`.
 *
 * ## The separation this phase must not blur
 *
 *     Phase 3.3   "What classification best describes the observed failure?"
 *     Phase 3.4   "Is the evidence strong enough to treat that classification as a defect candidate?"
 *
 * The gate is NOT a classifier. It never re-decides what happened, never overrides a class, and never
 * invents one. It reads a finished observation plus the structured evidence behind it and answers one
 * question about evidence SUFFICIENCY.
 *
 * ## What this phase does NOT do
 *
 * It decides nothing about Bugzilla. Filing, suppression, fingerprints, grouping and auto-resolution
 * are untouched: the gate writes a parallel shadow artifact and a divergence report, and nothing
 * reads either back into the existing pipeline.
 *
 * ## The rule that governs every judgement here
 *
 * The objective is evidence QUALITY, never a smaller Bugzilla queue. A finding whose evidence is
 * inconclusive stays VISIBLE as `INDETERMINATE`; it is never quietly demoted to "not a defect" and no
 * test, validator, endpoint, status code or negative case is excluded to make the numbers look
 * better.
 */

import type { ExchangeEvidence, ResponseOrigin } from './evidence';
import type { EvidenceReference, FailureClass, ViolationType } from './classification';
import type { ReachabilityState } from './reachability';

/**
 * The three answers, and why there are three rather than two.
 *
 *  - **ELIGIBLE** — deterministic evidence supports treating this as an application-defect candidate.
 *  - **NOT_ELIGIBLE** — deterministic evidence shows it is NOT one: an intermediary answered, the
 *    teardown failed, the validator faulted, the host declared throttling.
 *  - **INDETERMINATE** — the evidence is insufficient to decide either way.
 *
 * `INDETERMINATE` is deliberately not collapsed into `NOT_ELIGIBLE`. Collapsing them would erase the
 * difference between "we proved this is not a defect" and "we could not tell", and that difference is
 * the entire measurement this phase exists to produce: the second group names the evidence the bench
 * is missing, and is the roadmap for later phases. Treating them alike would also make the gate look
 * far more decisive than its evidence warrants.
 */
export const CONFIDENCE_DECISIONS = ['ELIGIBLE', 'NOT_ELIGIBLE', 'INDETERMINATE'] as const;
export type ConfidenceDecision = (typeof CONFIDENCE_DECISIONS)[number];

/**
 * Why the gate answered as it did. One code per RULE, centralized here so no string literal is ever
 * written at a decision site — a distribution over these codes says which rules actually carry the
 * gate against real traffic and which have never fired.
 *
 * Names deliberately echo the Phase 3.3 `REASON_CODES` where the two describe the same evidence
 * (`NO_DECIDING_EXCHANGE`, `PRECONDITION_FAILED`), so a classification and a gate decision can be
 * read side by side. They are a separate vocabulary because they answer a different question: a
 * classifier code says why a CLASS was chosen, a gate code says why the evidence was or was not
 * SUFFICIENT.
 */
export const GATE_REASON_CODES = [
  /** The only route to ELIGIBLE. Every condition in the eligibility set was satisfied. */
  'APPLICATION_EVIDENCE_CONFIRMED',

  // ---- Deterministic proof that this is not an application-defect candidate -------------------
  /** The deciding exchange ran while the framework was tearing down. */
  'CLEANUP_PHASE',
  /** A setup exchange failed before the action ran, so the subject was never exercised. */
  'PRECONDITION_FAILED',
  /** The deciding exchange itself belongs to the precondition phase, not the action. */
  'PRECONDITION_PHASE',
  /** The evidence attributes the failure to the test: a programming fault or a wrong expectation. */
  'TEST_INTEGRITY_FAILURE',
  /** Declared throttling, a refused teardown, or another environment condition. */
  'ENVIRONMENT_EVIDENCE',
  /** A transport failure or an intermediary response — below or in front of the application. */
  'INFRASTRUCTURE_EVIDENCE',
  /** The endpoint's own configuration declares the capability intentionally unsupported. */
  'CAPABILITY_DECLARED_UNSUPPORTED',
  /** An intermediary answered, or nothing did. The application's behaviour is not in view. */
  'ORIGIN_NOT_APPLICATION',
  /** Every exchange for this endpoint was attributed away from the application. */
  'REACHABILITY_ABSENT',
  /** A defensive guard: the classification is not one the gate can promote. */
  'NOT_APP_DEFECT_CLASSIFICATION',

  // ---- The evidence is insufficient to decide -------------------------------------------------
  /** No recorded exchange could be matched to the failing check. */
  'NO_DECIDING_EXCHANGE',
  /** The producer of the deciding response could not be established. */
  'ORIGIN_UNKNOWN',
  /** No exchange witnessed the application, and at least one could not be attributed at all. */
  'REACHABILITY_NOT_PRESENT',
  /** The classifier itself could not conclude; the gate has no stronger evidence than it had. */
  'CLASSIFICATION_INSUFFICIENT_EVIDENCE',
  /** No structured statement of what the application was expected to answer. */
  'CONTRACT_EXPECTATION_MISSING',
  /** No declared response schema, or the captured body cannot re-witness the failure. */
  'SCHEMA_EVIDENCE_MISSING',
  /** No structured required-header contract, or the asserted headers are not witnessed by evidence. */
  'HEADER_EVIDENCE_MISSING',
  /** No structured expected or observed content type. */
  'CONTENT_TYPE_EVIDENCE_MISSING',
  /** The security property asserted is not witnessed by any structured evidence. */
  'SECURITY_EVIDENCE_INCOMPLETE',
  /** The input CONDITION under test is not structurally recorded. */
  'INPUT_VALIDATION_EVIDENCE_INCOMPLETE',
  /** No structured precondition/state, action and expected-rule record. */
  'BUSINESS_RULE_EVIDENCE_INCOMPLETE',
  /** No structured before/after state record; one response cannot prove a transition. */
  'STATE_EVIDENCE_INCOMPLETE',
  /** Phase 7 produces a transition record, but it is not yet carried on the observation. */
  'TRANSITION_RECORD_NOT_CARRIED',
  /** Phase 9 produces a before/after delta, but it is not yet carried on the observation. */
  'SIDE_EFFECT_RECORD_NOT_CARRIED',
  /** Two reads disagreed, but only one of them is recorded, so the disagreement is unwitnessed. */
  'CONSISTENCY_EVIDENCE_INCOMPLETE',
  /** A UI finding's evidence is a screenshot and a page state, neither of them structured here. */
  'UI_EVIDENCE_INCOMPLETE',
  /** A single latency sample cannot separate a transient slowdown from a regression. */
  'PERFORMANCE_REQUIRES_REPEATABILITY',
  /** The contract dimension under test could not be identified, so nothing can be verified. */
  'VIOLATION_TYPE_UNSUPPORTED',
] as const;
export type GateReasonCode = (typeof GATE_REASON_CODES)[number];

/** Which decision each reason code yields. Declared once, so a rule cannot drift from its code. */
export const DECISION_BY_REASON: Readonly<Record<GateReasonCode, ConfidenceDecision>> = {
  APPLICATION_EVIDENCE_CONFIRMED: 'ELIGIBLE',

  CLEANUP_PHASE: 'NOT_ELIGIBLE',
  PRECONDITION_FAILED: 'NOT_ELIGIBLE',
  PRECONDITION_PHASE: 'NOT_ELIGIBLE',
  TEST_INTEGRITY_FAILURE: 'NOT_ELIGIBLE',
  ENVIRONMENT_EVIDENCE: 'NOT_ELIGIBLE',
  INFRASTRUCTURE_EVIDENCE: 'NOT_ELIGIBLE',
  CAPABILITY_DECLARED_UNSUPPORTED: 'NOT_ELIGIBLE',
  ORIGIN_NOT_APPLICATION: 'NOT_ELIGIBLE',
  REACHABILITY_ABSENT: 'NOT_ELIGIBLE',
  NOT_APP_DEFECT_CLASSIFICATION: 'NOT_ELIGIBLE',

  NO_DECIDING_EXCHANGE: 'INDETERMINATE',
  ORIGIN_UNKNOWN: 'INDETERMINATE',
  REACHABILITY_NOT_PRESENT: 'INDETERMINATE',
  CLASSIFICATION_INSUFFICIENT_EVIDENCE: 'INDETERMINATE',
  CONTRACT_EXPECTATION_MISSING: 'INDETERMINATE',
  SCHEMA_EVIDENCE_MISSING: 'INDETERMINATE',
  HEADER_EVIDENCE_MISSING: 'INDETERMINATE',
  CONTENT_TYPE_EVIDENCE_MISSING: 'INDETERMINATE',
  SECURITY_EVIDENCE_INCOMPLETE: 'INDETERMINATE',
  INPUT_VALIDATION_EVIDENCE_INCOMPLETE: 'INDETERMINATE',
  BUSINESS_RULE_EVIDENCE_INCOMPLETE: 'INDETERMINATE',
  STATE_EVIDENCE_INCOMPLETE: 'INDETERMINATE',
  TRANSITION_RECORD_NOT_CARRIED: 'INDETERMINATE',
  SIDE_EFFECT_RECORD_NOT_CARRIED: 'INDETERMINATE',
  CONSISTENCY_EVIDENCE_INCOMPLETE: 'INDETERMINATE',
  UI_EVIDENCE_INCOMPLETE: 'INDETERMINATE',
  PERFORMANCE_REQUIRES_REPEATABILITY: 'INDETERMINATE',
  VIOLATION_TYPE_UNSUPPORTED: 'INDETERMINATE',
};

/**
 * The named conditions a decision rests on — explicit gates, never a score.
 *
 * A single number ("7/10 = bug") destroys exactly the information this phase exists to produce: it
 * cannot say WHICH evidence was missing, it invites tuning a threshold until the queue looks right,
 * and it makes two very different weak findings indistinguishable. Every factor here is a boolean
 * derived from structured evidence, and every one can be read back off a stored decision.
 *
 * No numeric confidence value is produced anywhere in this phase.
 */
export interface ConfidenceFactors {
  /** The deciding response carried an application marker (Phase 3.2 attribution). */
  applicationAttributed: boolean;
  /** Some exchange for this endpoint demonstrably reached the application. */
  reachabilityPresent: boolean;
  /** A recorded exchange was matched to the failing check. */
  decidingExchangePresent: boolean;
  /** A structured contract exists for the DIMENSION under test — not merely any contract. */
  contractPresent: boolean;
  /** The deciding exchange belongs to the action phase, not setup or teardown. */
  actionPhase: boolean;
  /** Nothing in the evidence attributes the failure to the test itself. */
  testIntegrityClean: boolean;
  /** Nothing in the evidence attributes the failure to the environment or infrastructure. */
  environmentClean: boolean;
  /** Enough samples of the same measurement exist to distinguish a transient from a regression. */
  repeatabilityAvailable: boolean;
  /** Structured before/after state records exist for the action. */
  stateEvidenceAvailable: boolean;
  /** Structured evidence witnesses the security property that was asserted. */
  securityEvidenceAvailable: boolean;

  /*
   * ---- Phase 13 factors -----------------------------------------------------------------------
   *
   * Both are RECORDED, and neither is enforced. The master plan is explicit twice over — "keep the
   * existing confidence gate shadow-only until evidence is mature" and "do not enforce confidence
   * prematurely" — so these change no decision today. They exist so that when the gate is armed,
   * the evidence it would need has been measured all along rather than retrofitted, and so a shadow
   * run can show how often each is actually available.
   */

  /**
   * An INDEPENDENT observation confirmed the behaviour (Phase 11).
   *
   * False covers three different situations on purpose — no confirmation was attempted, one was
   * attempted down a path that was not independent, or one was attempted and did not reproduce. The
   * gate must not treat any of them as evidence FOR a defect, and the confirmation record itself
   * keeps the distinction for a reader.
   */
  independentlyConfirmed: boolean;

  /**
   * This finding is a fresh canonical defect rather than another sighting of one already known
   * (Phase 12).
   *
   * False is not a mark against the finding: a second sighting is often the strongest evidence a
   * defect is real. It is recorded because filing needs it and confidence must not silently double
   * count one fault seen twice.
   */
  distinctCanonicalDefect: boolean;
}

/**
 * What the endpoint's own registered configuration declares, as carried on a `ValidationReport`.
 *
 * Every field is a STRUCTURED value that already exists on `ResolvedEndpoint`; none is derived from a
 * message, a validator name or an endpoint name. A field that is absent is treated as absent
 * evidence — never as permission to guess.
 */
export interface GateContract {
  /** Statuses the endpoint is configured to answer. */
  expectedStatus?: readonly number[];
  /** The content type the endpoint is configured to return. */
  contentType?: string;
  /** Whether the endpoint's registered contract declares a response schema at all. */
  responseSchemaDeclared?: boolean;
  /** Response headers the endpoint's contract requires. Names only. */
  requiredHeaders?: readonly string[];
  /** The configured latency budget. */
  maxResponseTimeMs?: number;
  /** The configuration declares the capability intentionally unsupported. */
  declaredUnsupported?: boolean;
}

/**
 * Everything the gate is allowed to read.
 *
 * Structured only. The caller resolves `deciding` from the observation's `correlationId` against the
 * evidence it already holds, so the gate never has to reconstruct anything from prose — and it is
 * given no prose it could reconstruct from: the observation's rendered `expected` / `actual` /
 * `summary` strings are present on the observation but are never read by any rule.
 */
export interface ConfidenceInput {
  observation: GateObservation;
  /** The exchange the classifier judged, resolved by correlation id. */
  deciding?: ExchangeEvidence;
  /** Every exchange observed for this endpoint in this test. */
  exchanges: readonly ExchangeEvidence[];
  contract?: GateContract;
  /**
   * Statuses the CHECK itself declared — CORROBORATION ONLY, never authority.
   *
   * Parsed from structured numbers by the caller through Phase 3.3's `expectedStatuses`, which
   * accepts a number or an all-number array and nothing else, so a message can never reach it.
   *
   * It is deliberately not sufficient for eligibility:
   *
   *     VALIDATOR ASSERTION  !=  REGISTERED APPLICATION CONTRACT
   *
   * By the time a number reaches the gate it carries no provenance, so the gate cannot tell one read
   * from the endpoint registry from one a validator hard-coded. Only `GateContract.expectedStatus`,
   * which is written onto the report from the `ResolvedEndpoint`, can establish what the application
   * was contracted to answer. This field is recorded alongside it so the two can be compared.
   */
  checkExpectedStatuses?: readonly number[];

  /*
   * ---- Phase 13 evidence, carried and RECORDED but never enforced -----------------------------
   *
   * The master plan says it twice: keep the gate shadow-only, do not enforce confidence
   * prematurely. These are here so the shadow run can measure how often each is actually available
   * before anything is armed on them.
   */

  /** The Phase 11 confirmation of this finding, when one was attempted. */
  confirmation?: { readonly outcome: 'CONFIRMED' | 'NOT_REPRODUCED' | 'INDETERMINATE' };

  /** The canonical defect this finding is another sighting of, when it is one (Phase 12). */
  duplicateOf?: string;
}

/**
 * The part of a Phase 3.3 `Observation` the gate reads.
 *
 * A narrow structural type rather than the full `Observation`, so it is impossible for a rule to
 * reach the rendered prose fields, and so the gate can be unit-tested without constructing a whole
 * observation. Any `Observation` satisfies it.
 */
export interface GateObservation {
  runId: string;
  testCaseId?: string;
  correlationId?: string;
  decidingCorrelationIds: readonly string[];
  endpoint: string;
  endpointId: string;
  suite: string;
  validatorName: string;
  category: string;
  severity: string;
  phase?: string;
  classification: FailureClass;
  violationType: ViolationType;
  /** The classifier's own reason code, carried through so the two decisions can be read together. */
  reasonCode: string;
  cleanupRelated: boolean;
  origin?: ResponseOrigin;
  reachability: ReachabilityState;
}

/** What the pure gate returns. Persistence and identity are the caller's job. */
export interface ConfidenceAssessment {
  decision: ConfidenceDecision;
  reasonCode: GateReasonCode;
  /** One sentence a human can act on. Never contains a body, a header value or a secret. */
  summary: string;
  factors: ConfidenceFactors;
  supportingEvidence: readonly EvidenceReference[];
  /** The evidence the gate WANTED and did not have — the reason an answer is weak, stated plainly. */
  missingEvidence: readonly string[];
}

/**
 * The durable shadow record: an assessment plus the identity needed to correlate it.
 *
 * Deliberately carries NO rendered `expected` / `actual`, no response snippet, no request body and no
 * header VALUES beyond bounded structured scalars. Everything that could describe payload content is
 * referenced by `correlationId` into `reports/evidence.jsonl`, which is the single source of truth
 * for what an exchange looked like.
 */
export interface ConfidenceDecisionRecord {
  runId: string;
  testCaseId?: string;
  /**
   * A deterministic key for the observation this decision is about.
   *
   * `endpointId|validatorName|correlationId`. Derived from identifiers only, stable across runs of
   * the same shape, and never a random value — so two runs can be diffed record by record.
   */
  observationKey: string;
  correlationId?: string;
  decidingCorrelationIds: readonly string[];

  endpoint: string;
  endpointId: string;
  suite: string;
  validatorName: string;
  category: string;
  severity: string;
  phase?: string;
  origin?: ResponseOrigin;
  reachability: ReachabilityState;

  classification: FailureClass;
  violationType: ViolationType;
  /** The Phase 3.3 reason code, so a divergence can be traced to the rule that classified it. */
  classifierReasonCode: string;

  decision: ConfidenceDecision;
  reasonCode: GateReasonCode;
  summary: string;
  factors: ConfidenceFactors;
  supportingEvidence: readonly EvidenceReference[];
  missingEvidence: readonly string[];

  gateVersion: string;
  classifierVersion: string;
  createdAt: string;
}

/**
 * Bumped whenever a gate rule changes meaning, so a stored decision can always be read against the
 * rules that produced it. A distribution is only comparable across runs of the same version.
 */
export const GATE_VERSION = '3.4.0';

/** The deterministic observation key. Identifiers only — nothing here can carry payload content. */
export function observationKeyOf(observation: GateObservation): string {
  return `${observation.endpointId}|${observation.validatorName}|${observation.correlationId ?? 'none'}`;
}
