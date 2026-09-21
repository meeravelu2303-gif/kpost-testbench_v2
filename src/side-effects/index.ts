/**
 * Side-Effect Verification (master plan §11).
 *
 *     Phase 7   state transition   did this RESOURCE reach the declared state?
 *     HERE      side effect        did the DERIVED value elsewhere change as a consequence?
 *
 * Two different questions with two different failures. A message can be correctly marked read while
 * the recipient's unread badge never moves, and only a count comparison finds that.
 *
 * The layer is pure and narrow: it compares a before and an after against an expectation and returns
 * `OBSERVED | NOT_OBSERVED | INDETERMINATE`. It assigns no verdict, and it imports no engine, no
 * validator and no reporter — a spec turns the outcome into an assertion.
 */

export {
  SIDE_EFFECT_OUTCOMES,
  checkSideEffect,
  summariseSideEffects,
  type SideEffectCheck,
  type SideEffectEvidence,
  type SideEffectExpectation,
  type SideEffectOutcome,
} from './check';
