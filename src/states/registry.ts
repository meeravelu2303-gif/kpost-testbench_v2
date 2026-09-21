import { KALL_OBSERVATIONS, KALL_TRANSITIONS, KALL_VOCABULARY } from './catalogue/kall';
import {
  KATCHUP_MESSAGE_OBSERVATIONS,
  KATCHUP_MESSAGE_TRANSITIONS,
  KATCHUP_MESSAGE_VOCABULARY,
} from './catalogue/katchup-message';
import {
  KMAIL_TRANSACTION_OBSERVATIONS,
  KMAIL_TRANSACTION_TRANSITIONS,
  KMAIL_TRANSACTION_VOCABULARY,
} from './catalogue/kmail-transaction';
import { STATE_CONFLICTS } from './catalogue/conflicts';
import type { StateConflict } from './conflict';
import type { Observation } from './observation';
import type { StateTransition } from './transition';
import type { StateDefinition, StateResourceId, StateVocabulary } from './vocabulary';

/**
 * The State Model registry — read-only, deterministic, and empty of runtime state.
 *
 * ## What it is
 *
 * A set of lookups over frozen declarative data, so a future phase can ask:
 *
 *     What states are known for this resource?      statesOf(resource)
 *     What transitions are documented?              transitionsOf(resource) / transitionsInto(stateId)
 *     How can this state be observed?               observationsOf(stateId)
 *     What conflicts exist?                         conflictsOf(resource) / allConflicts()
 *     What requirement supports this transition?    transition(id)?.requirementIds
 *
 * ## What it is not
 *
 * Not a workflow engine and not a state machine. It advances nothing, validates no sequence, holds no
 * current state for anything, and has no mutable module-level variable: every export below is either
 * a frozen array or a pure function over one. Two callers asking the same question get the same
 * answer, in the same order, forever.
 *
 * Whether a resource IS in a given state is a runtime fact, and runtime facts live in the existing
 * evidence layer — never here.
 */

export const STATE_VOCABULARIES: readonly StateVocabulary[] = Object.freeze([
  KATCHUP_MESSAGE_VOCABULARY,
  KALL_VOCABULARY,
  KMAIL_TRANSACTION_VOCABULARY,
]);

export const STATE_TRANSITIONS: readonly StateTransition[] = Object.freeze([
  ...KATCHUP_MESSAGE_TRANSITIONS,
  ...KALL_TRANSITIONS,
  ...KMAIL_TRANSACTION_TRANSITIONS,
]);

export const STATE_OBSERVATIONS: readonly Observation[] = Object.freeze([
  ...KATCHUP_MESSAGE_OBSERVATIONS,
  ...KALL_OBSERVATIONS,
  ...KMAIL_TRANSACTION_OBSERVATIONS,
]);

const VOCABULARY_BY_RESOURCE: ReadonlyMap<string, StateVocabulary> = new Map(
  STATE_VOCABULARIES.map((vocabulary) => [vocabulary.resource, vocabulary]),
);

const STATE_BY_ID: ReadonlyMap<string, StateDefinition> = new Map(
  STATE_VOCABULARIES.flatMap((vocabulary) =>
    vocabulary.states.map((state) => [state.stateId, state] as const),
  ),
);

const TRANSITION_BY_ID: ReadonlyMap<string, StateTransition> = new Map(
  STATE_TRANSITIONS.map((transition) => [transition.transitionId, transition]),
);

const OBSERVATION_BY_ID: ReadonlyMap<string, Observation> = new Map(
  STATE_OBSERVATIONS.map((observation) => [observation.observationId, observation]),
);

// ---- vocabulary --------------------------------------------------------------------------------

/** The vocabulary for a resource, or `undefined` when the resource is not modelled. */
export function vocabulary(resource: string): StateVocabulary | undefined {
  return VOCABULARY_BY_RESOURCE.get(resource);
}

/** Every state known for a resource, in declaration order. */
export function statesOf(resource: StateResourceId): readonly StateDefinition[] {
  return vocabulary(resource)?.states ?? [];
}

/** One state by id, or `undefined`. */
export function state(stateId: string): StateDefinition | undefined {
  return STATE_BY_ID.get(stateId);
}

/** Whether a state id is registered. The check a transition or observation reference must pass. */
export function hasState(stateId: string): boolean {
  return STATE_BY_ID.has(stateId);
}

/** Every registered state id. */
export function allStateIds(): string[] {
  return [...STATE_BY_ID.keys()];
}

// ---- transitions -------------------------------------------------------------------------------

export function transition(transitionId: string): StateTransition | undefined {
  return TRANSITION_BY_ID.get(transitionId);
}

/** Every documented transition for a resource. */
export function transitionsOf(resource: StateResourceId): StateTransition[] {
  return STATE_TRANSITIONS.filter((candidate) => candidate.resource === resource);
}

/** Transitions that reach a state — "how does a message become Read?". */
export function transitionsInto(stateId: string): StateTransition[] {
  return STATE_TRANSITIONS.filter((candidate) => candidate.to === stateId);
}

/** Transitions that leave a state. */
export function transitionsFrom(stateId: string): StateTransition[] {
  return STATE_TRANSITIONS.filter((candidate) => candidate.from === stateId);
}

/**
 * Transitions the bench cannot drive, with the reason — the honest counterpart to `unboundSteps()`
 * in the Flow Model. A measurement of the gap, never a failure.
 */
export function undriveableTransitions(): { transition: StateTransition; reason: string }[] {
  return STATE_TRANSITIONS.filter((candidate) => candidate.mechanism !== 'API').map(
    (candidate) => ({
      transition: candidate,
      reason: candidate.unavailableReason ?? '(no reason recorded)',
    }),
  );
}

// ---- observations ------------------------------------------------------------------------------

export function observation(observationId: string): Observation | undefined {
  return OBSERVATION_BY_ID.get(observationId);
}

/** How a given state could be observed. Empty means no known mechanism — a recorded gap. */
export function observationsOf(stateId: string): Observation[] {
  return STATE_OBSERVATIONS.filter((candidate) => candidate.observes.includes(stateId));
}

/** Every observation for a resource. */
export function observationsFor(resource: StateResourceId): Observation[] {
  return STATE_OBSERVATIONS.filter((candidate) => candidate.resource === resource);
}

/**
 * States with no observation mechanism at all.
 *
 * The question a later phase most needs answered before it promises to verify anything.
 */
export function unobservableStates(): StateDefinition[] {
  return [...STATE_BY_ID.values()].filter(
    (candidate) => observationsOf(candidate.stateId).length === 0,
  );
}

/** Endpoint ids this model references. Strings — resolving them is the framework guard's job. */
export function referencedEndpointIds(): string[] {
  const ids = new Set<string>();
  for (const candidate of STATE_OBSERVATIONS) ids.add(candidate.endpointId);
  for (const candidate of STATE_TRANSITIONS) {
    if (candidate.endpointId) ids.add(candidate.endpointId);
  }
  return [...ids].sort();
}

/** Requirement ids this model references. */
export function referencedRequirementIds(): string[] {
  return [...new Set(STATE_TRANSITIONS.flatMap((candidate) => candidate.requirementIds))].sort();
}

// ---- conflicts ---------------------------------------------------------------------------------

export function allConflicts(): readonly StateConflict[] {
  return STATE_CONFLICTS;
}

export function conflict(conflictId: string): StateConflict | undefined {
  return STATE_CONFLICTS.find((candidate) => candidate.conflictId === conflictId);
}

/** Conflicts touching a resource, including the cross-resource ones (`resource: null`). */
export function conflictsOf(resource: StateResourceId): StateConflict[] {
  return STATE_CONFLICTS.filter(
    (candidate) => candidate.resource === resource || candidate.resource === null,
  );
}
