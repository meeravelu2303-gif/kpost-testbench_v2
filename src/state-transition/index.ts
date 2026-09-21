/**
 * State Transition Validation (master plan §9).
 *
 *     Phase 4B  states + transitions   what the documentation DECLARES
 *     Phase 4C  state observation      what a response ACTUALLY held
 *     Phase 6   flow execution         what the application was ASKED to do
 *          ↓
 *     HERE      did the declared change OCCUR?
 *
 * The narrowest layer in the chain, and deliberately so. It takes a declared transition and a
 * before/after pair of observations and returns `OCCURRED | NOT_OCCURRED | INDETERMINATE` with the
 * observed values and the reason. It assigns no verdict, no severity and no blame: a spec turns the
 * outcome into an assertion, Phase 10 classifies a failure, and neither happens here.
 *
 * `INDETERMINATE` is the member that earns the layer its keep. A transition whose before-state was
 * never observed did not fail — nothing is known about it — and a bench that cannot say so ends up
 * manufacturing defects out of missing evidence.
 */

export {
  TRANSITION_OUTCOMES,
  checkTransition,
  summariseChecks,
  type TransitionCheck,
  type TransitionEvidence,
  type TransitionOutcome,
} from './check';
