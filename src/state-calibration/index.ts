/**
 * State Calibration — establishing, from controlled LIVE observation, what the real application
 * exposes.
 *
 * Phase 4D. The top of the state stack, and the only layer that involves a real KPOST host:
 *
 *     states            declares what states and transitions are documented
 *        ↑
 *     state-observation extracts a state value from a captured response
 *        ↑
 *     state-calibration records those values across a controlled scenario and says what they establish
 *
 * ## What it answers, and what it never answers
 *
 * It answers *"what does the real application expose?"*. It does not answer *"is that correct?"* —
 * there is no expectation, no assertion, no pass/fail, no severity, no confidence and nothing to do
 * with Bugzilla anywhere in this module, and framework guards assert each absence.
 *
 * A finding whose evidence does not settle a question returns `UNKNOWN` with what would settle it.
 * Nothing here is permitted to force a conclusion, and nothing here rewrites the State Model or the
 * requirement registry to make a live run tidy: where live evidence contradicts documentation, the
 * contradiction is the finding.
 *
 * ## Execution lives in the spec, not here
 *
 * This module is pure. It holds no HTTP client, drives no browser and performs no login: a gated
 * calibration spec performs the scenario with the bench's existing executor, account pool and
 * resource ledger, and hands the observations here to be recorded and interpreted.
 */

export {
  CALIBRATION_VERDICTS,
  FORBIDDEN_CALIBRATION_TERMS,
  type CalibrationCleanupRecord,
  type CalibrationFinding,
  type CalibrationRecord,
  type CalibrationResult,
  type CalibrationVerdict,
} from './calibration-result';

export { CalibrationSession } from './session';

export {
  KATCHUP_PHASES,
  deriveReadPerspective,
  deriveReadTransitionMechanism,
  observedRepresentation,
} from './katchup-read';
