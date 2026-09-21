/**
 * The Business Invariant Model — WHAT the product must do, declared once, with its provenance.
 *
 * Master plan §7. Declarative only: no execution, no validator, no engine, no Bugzilla. It says what
 * must hold, who says so, whose perspective it constrains, what would prove it, and how well the
 * bench demonstrates it today. Driving the rules is Phase 6 (flow execution) and Phase 7 (state
 * transition validation); judging a failure is Phase 10 onward.
 *
 * ## Deliberately separate from `../business-rule.ts`
 *
 * That file is an executable, endpoint-scoped check bound to the validation engine, and it stays
 * exactly as it is. An invariant that imported the machinery meant to verify it could not be used to
 * judge that machinery — so this sub-module imports neither, and a framework guard asserts it.
 *
 * ## What is deliberately absent
 *
 * No `check()`. No expected status code. No pass/fail. No confidence. An invariant is a claim about
 * the product; whether a given run satisfied it is a different question, asked by a different layer.
 */

export {
  EVIDENCE_KINDS,
  INVARIANT_MODULES,
  INVARIANT_STATUSES,
  isInvariantModule,
  isInvariantStatus,
  type BusinessInvariant,
  type EvidenceKind,
  type InvariantModule,
  type InvariantStatus,
} from './invariant';

export {
  BUSINESS_INVARIANTS,
  INVARIANT_PROBLEM_CODES,
  conflictedInvariants,
  hasInvariant,
  invariant,
  invariantSummary,
  invariantsForRequirement,
  invariantsOf,
  invariantsWithStatus,
  validateInvariants,
  type InvariantProblem,
  type InvariantProblemCode,
  type InvariantSummary,
  type InvariantVocabulary,
} from './registry';
