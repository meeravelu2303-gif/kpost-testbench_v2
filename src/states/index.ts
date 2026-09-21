/**
 * The Application State Model — WHAT states a KPOST resource has, and how they could be observed.
 *
 * Phase 4B. A declarative layer describing the application, sitting beside the Flow and Actor models:
 *
 *     Requirement  →  Flow  →  FlowStep  →  (Actor performs)  →  application STATE changes
 *                                                                        ↑
 *                                                        this module describes that
 *
 * ## What this layer owns
 *
 *  - the documented state vocabulary of three resource families, in the application's own words;
 *  - the documented transitions between those states, with the documented actor and requirement ids;
 *  - where each state could be read from (endpoint id + response field path);
 *  - every unresolved disagreement between sources about any of the above.
 *
 * ## What this layer does NOT own, and must never gain
 *
 * It executes nothing. No HTTP, no Playwright, no database, no UI action. It imports nothing from the
 * validators, the engine, the API client, the reporters, the failure classifier, the confidence gate
 * or Bugzilla, and a framework guard asserts that.
 *
 * It also holds **no runtime value**. An `Observation` says where a state could be read; it has no
 * field capable of saying what that value currently is. Deciding whether an observed value is correct
 * is assertion work and belongs to the specs and validators that already do it; deciding whether an
 * actor MAY perform a transition is the future Business Invariant Model's question. Neither is here.
 *
 * It replaces nothing: the resource ledger still owns what the bench created, `FlowRun` still owns
 * execution status and artifact availability, and `src/failure-analysis/` still owns classification.
 *
 * ## Scope
 *
 * Three resource families, matching the Phase 4A evidence: `katchup.message`, `kall`,
 * `kmail.transaction`. Group is excluded because the documented API has no group read endpoint, so a
 * declared group state could never be confirmed; KDiary, attachments and drafts are excluded for want
 * of a usable vocabulary. Those are recorded decisions, not omissions.
 */

export {
  EVIDENCE_STATUSES,
  hasUsableProvenance,
  isEvidenceStatus,
  type EvidenceStatus,
  type Provenance,
} from './provenance';

export {
  STATE_REPRESENTATIONS,
  STATE_RESOURCES,
  STATE_ROLES,
  STATE_SCOPES,
  type StateDefinition,
  type StateRepresentation,
  type StateResourceId,
  type StateRole,
  type StateScope,
  type StateVocabulary,
} from './vocabulary';

export {
  TRANSITION_MECHANISMS,
  type StateTransition,
  type TransitionMechanism,
} from './transition';

export { FORBIDDEN_OBSERVATION_KEYS, type Observation } from './observation';

export {
  STATE_CONFLICT_KINDS,
  STATE_CONFLICT_STATUSES,
  type ConflictPosition,
  type StateConflict,
  type StateConflictKind,
  type StateConflictStatus,
} from './conflict';

export {
  STATE_OBSERVATIONS,
  STATE_TRANSITIONS,
  STATE_VOCABULARIES,
  allConflicts,
  allStateIds,
  conflict,
  conflictsOf,
  hasState,
  observation,
  observationsFor,
  observationsOf,
  referencedEndpointIds,
  referencedRequirementIds,
  state,
  statesOf,
  transition,
  transitionsFrom,
  transitionsInto,
  transitionsOf,
  undriveableTransitions,
  unobservableStates,
  vocabulary,
} from './registry';

export {
  STATE_PROBLEM_CODES,
  assertValidStateModel,
  validateStateModel,
  type StateProblem,
  type StateProblemCode,
} from './validate';

export { STATE_CONFLICTS } from './catalogue/conflicts';
export { KATCHUP_MESSAGE_VOCABULARY } from './catalogue/katchup-message';
export { KALL_VOCABULARY } from './catalogue/kall';
export { KMAIL_TRANSACTION_VOCABULARY } from './catalogue/kmail-transaction';
