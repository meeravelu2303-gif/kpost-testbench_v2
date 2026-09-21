import { isActorRoleId } from '../actors/role';
import { hasRequirement } from '../requirements/index';
import { FORBIDDEN_OBSERVATION_KEYS } from './observation';
import { hasUsableProvenance } from './provenance';
import {
  allConflicts,
  hasState,
  STATE_OBSERVATIONS,
  STATE_TRANSITIONS,
  STATE_VOCABULARIES,
} from './registry';
import type { StateDefinition } from './vocabulary';

/**
 * Static validation of the State Model — everything checkable without executing anything.
 *
 * Pure and total: it reads the declared model and returns problems. No I/O, no clock, no network, and
 * no endpoint registry (endpoint ids are strings here and are resolved by a framework guard, which is
 * the one place the state layer and the API layer are allowed to meet — the same arrangement the Flow
 * Model uses).
 *
 * ## The rules that matter most
 *
 * **Provenance is mandatory.** A state, transition or observation whose evidence cannot be checked is
 * rejected outright. That is the rule the whole module exists to enforce.
 *
 * **An observation may not claim a runtime value.** Checked structurally against
 * `FORBIDDEN_OBSERVATION_KEYS`, so the boundary survives someone adding a field in a hurry.
 */

export const STATE_PROBLEM_CODES = [
  'MISSING_PROVENANCE',
  'EMPTY_FIELD',
  'DUPLICATE_STATE_ID',
  'DUPLICATE_TRANSITION_ID',
  'DUPLICATE_OBSERVATION_ID',
  'UNKNOWN_STATE_REFERENCE',
  'UNKNOWN_REQUIREMENT',
  'UNKNOWN_ACTOR_ROLE',
  'MISSING_ENDPOINT_FOR_API_TRANSITION',
  'MISSING_REASON_FOR_UNDRIVEABLE_TRANSITION',
  'ENDPOINT_ON_NON_API_TRANSITION',
  'OBSERVATION_CLAIMS_RUNTIME_VALUE',
  'OBSERVATION_OBSERVES_NOTHING',
  'TRANSITION_TARGETS_CLASSIFIER',
  'CONFLICT_WITH_ONE_POSITION',
] as const;
export type StateProblemCode = (typeof STATE_PROBLEM_CODES)[number];

export interface StateProblem {
  code: StateProblemCode;
  /** The record the problem concerns. */
  subjectId: string;
  message: string;
}

function checkProvenance(
  record: { provenance: Parameters<typeof hasUsableProvenance>[0] },
  subjectId: string,
  add: (code: StateProblemCode, subjectId: string, message: string) => void,
): void {
  if (!hasUsableProvenance(record.provenance)) {
    add(
      'MISSING_PROVENANCE',
      subjectId,
      'every state, transition and observation must carry a status and a non-empty citation — a ' +
        'claim whose evidence cannot be checked is exactly what this model exists to prevent',
    );
  }
}

/** Every problem with the declared model. An empty array means it is internally consistent. */
export function validateStateModel(): StateProblem[] {
  const problems: StateProblem[] = [];
  const add = (code: StateProblemCode, subjectId: string, message: string): void => {
    problems.push({ code, subjectId, message });
  };

  // ---- vocabularies ---------------------------------------------------------------------------
  const seenStateIds = new Set<string>();
  const states: StateDefinition[] = [];
  for (const vocabulary of STATE_VOCABULARIES) {
    checkProvenance(vocabulary, vocabulary.resource, add);
    for (const definition of vocabulary.states) {
      states.push(definition);
      if (seenStateIds.has(definition.stateId)) {
        add('DUPLICATE_STATE_ID', definition.stateId, 'state id is declared more than once');
      }
      seenStateIds.add(definition.stateId);
      checkProvenance(definition, definition.stateId, add);

      for (const [field, value] of [
        ['term', definition.term],
        ['rawValue', definition.rawValue],
        ['field', definition.field],
        ['meaning', definition.meaning],
      ] as const) {
        if (!value.trim()) {
          add(
            'EMPTY_FIELD',
            definition.stateId,
            `${field} must not be empty — the literal term, value and field are the whole point`,
          );
        }
      }
    }
  }

  // ---- transitions ----------------------------------------------------------------------------
  const seenTransitionIds = new Set<string>();
  for (const candidate of STATE_TRANSITIONS) {
    const id = candidate.transitionId;
    if (seenTransitionIds.has(id)) {
      add('DUPLICATE_TRANSITION_ID', id, 'transition id is declared more than once');
    }
    seenTransitionIds.add(id);
    checkProvenance(candidate, id, add);

    if (candidate.from !== null && !hasState(candidate.from)) {
      add('UNKNOWN_STATE_REFERENCE', id, `from-state "${candidate.from}" is not a declared state`);
    }
    if (!hasState(candidate.to)) {
      add('UNKNOWN_STATE_REFERENCE', id, `to-state "${candidate.to}" is not a declared state`);
    }

    // A CLASSIFIER says what a row IS, so nothing can transition into it. Catching this keeps the
    // katchupStatus overload from quietly becoming a lifecycle again.
    const target = states.find((definition) => definition.stateId === candidate.to);
    if (target?.role === 'CLASSIFIER') {
      add(
        'TRANSITION_TARGETS_CLASSIFIER',
        id,
        `to-state "${candidate.to}" is a CLASSIFIER — it classifies the row rather than recording ` +
          'anything that happened to it, so nothing transitions into it',
      );
    }

    for (const requirementId of candidate.requirementIds) {
      if (!hasRequirement(requirementId)) {
        add(
          'UNKNOWN_REQUIREMENT',
          id,
          `requirement "${requirementId}" is not in the Phase 1 registry; fix the reference — a ` +
            'requirement is never invented here, and business-rule ids (BR-*) belong in provenance',
        );
      }
    }

    if (candidate.actor !== undefined) {
      const roleId: string = candidate.actor;
      if (!isActorRoleId(roleId)) {
        add('UNKNOWN_ACTOR_ROLE', id, `actor role "${roleId}" is not in the Phase 3 role registry`);
      }
    }

    if (candidate.mechanism === 'API' && !candidate.endpointId?.trim()) {
      add(
        'MISSING_ENDPOINT_FOR_API_TRANSITION',
        id,
        'a transition whose mechanism is API must name the endpoint that performs it',
      );
    }
    if (candidate.mechanism !== 'API') {
      if (!candidate.unavailableReason?.trim()) {
        add(
          'MISSING_REASON_FOR_UNDRIVEABLE_TRANSITION',
          id,
          'a transition the bench cannot drive must say why, so the gap is visible rather than ' +
            'implied by absence',
        );
      }
      if (candidate.endpointId !== undefined) {
        add(
          'ENDPOINT_ON_NON_API_TRANSITION',
          id,
          `mechanism is ${candidate.mechanism} but an endpointId is set — that would imply the ` +
            'bench can drive it',
        );
      }
    }
  }

  // ---- observations ---------------------------------------------------------------------------
  const seenObservationIds = new Set<string>();
  for (const candidate of STATE_OBSERVATIONS) {
    const id = candidate.observationId;
    if (seenObservationIds.has(id)) {
      add('DUPLICATE_OBSERVATION_ID', id, 'observation id is declared more than once');
    }
    seenObservationIds.add(id);
    checkProvenance(candidate, id, add);

    if (candidate.observes.length === 0) {
      add(
        'OBSERVATION_OBSERVES_NOTHING',
        id,
        'an observation must name at least one state it reveals',
      );
    }
    for (const stateId of candidate.observes) {
      if (!hasState(stateId)) {
        add('UNKNOWN_STATE_REFERENCE', id, `observes "${stateId}", which is not a declared state`);
      }
    }
    if (!candidate.endpointId.trim() || !candidate.fieldPath.trim()) {
      add(
        'EMPTY_FIELD',
        id,
        'an observation must name both an endpoint and an explicit field path',
      );
    }
    for (const forbidden of FORBIDDEN_OBSERVATION_KEYS) {
      if (forbidden in (candidate as unknown as Record<string, unknown>)) {
        add(
          'OBSERVATION_CLAIMS_RUNTIME_VALUE',
          id,
          `carries "${forbidden}". An observation describes HOW a state could be read, never what ` +
            'it currently is — a runtime value belongs to the evidence layer, not to declarative data',
        );
      }
    }
  }

  // ---- conflicts ------------------------------------------------------------------------------
  for (const candidate of allConflicts()) {
    if (candidate.positions.length < 2) {
      add(
        'CONFLICT_WITH_ONE_POSITION',
        candidate.conflictId,
        'a conflict must record at least two positions — one position is a claim, not a conflict, ' +
          'and collapsing a disagreement to a single side is precisely what must not happen',
      );
    }
    for (const position of candidate.positions) {
      if (!position.claim.trim() || !position.citation.trim()) {
        add(
          'EMPTY_FIELD',
          candidate.conflictId,
          'every conflict position needs both a claim and a citation',
        );
      }
    }
    if (!candidate.resolutionRequires.trim()) {
      add(
        'EMPTY_FIELD',
        candidate.conflictId,
        'a conflict must say what would settle it, so a later phase knows what to measure',
      );
    }
  }

  return problems;
}

/** Throws on the first problem, listing them all. Used by the framework guard. */
export function assertValidStateModel(): void {
  const problems = validateStateModel();
  if (problems.length === 0) return;
  throw new Error(
    'the State Model is invalid:\n' +
      problems.map((p) => `  [${p.code}] ${p.subjectId}: ${p.message}`).join('\n'),
  );
}
