import {
  observation as observationDefinition,
  STATE_OBSERVATIONS,
  state as stateDefinition,
  vocabulary,
  type Observation,
  type StateResourceId,
} from '../states/index';
import type { StateObservation } from './observation-result';
import { parseFieldPath, resolveFieldPath, type FieldMatch, type ValuePresence } from './path';

/**
 * The extractor — turns an already-captured response into state observations.
 *
 * ## Read-only, in every sense
 *
 * It takes a parsed body and returns records. It sends nothing, writes nothing, and mutates nothing:
 * not the flow run, not the resource ledger, not the application, not confidence, not a bug
 * candidate. It does not even hold state between calls.
 *
 * ## Why the input is structural rather than an imported type
 *
 * `observeExchange` accepts anything shaped like `ObservableExchange`, which the existing
 * `ApiResponseWrapper` already satisfies — so a call site passes its exchange straight in, with no
 * adapter and no second representation of a response. It is declared structurally rather than
 * imported because this layer must not depend on the API client (a dependency that would also make
 * the module unusable from a pure unit test). The same reasoning the Flow and State models use for
 * endpoint ids: reference the shape, not the module.
 */

export class StateObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateObservationError';
  }
}

/** What the extractor needs to know about an exchange, and nothing more. */
export interface ObservationContext {
  /** Which Phase 4B observation definition to apply. Must be registered. */
  readonly observationId: string;
  /** The evidence correlation key — how this observation is traced back to the captured exchange. */
  readonly correlationId: string;
  readonly runId?: string;
  readonly testCaseId?: string;
  readonly label?: string;
  /** ISO timestamp. Defaults to the caller-supplied exchange time, or now. */
  readonly observedAt?: string;
  /**
   * The acting identity from REQUEST context, if the caller has one. Never inferred from the
   * response; see `StateObservation.actorId`.
   */
  readonly actorId?: string;
}

/**
 * The parts of an exchange this layer reads. `ApiResponseWrapper` satisfies it structurally.
 *
 * `json()` is the repository's existing memoised parse, returning `{ok:true,value}` or
 * `{ok:false,reason}` — reused rather than re-parsing `bodyText`, so a malformed body is reported
 * the same way everywhere.
 */
export interface ObservableExchange {
  readonly correlationId: string;
  readonly label?: string;
  json(): { ok: true; value: unknown } | { ok: false; reason: string };
}

const asIdString = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

/**
 * Finds the instance id for a match.
 *
 * Looks on the row first, then the parent row. Both are needed and neither is a fallback guess: a
 * Katchup message carries `msgID` on its own row, while a Kall participant's `kallID` lives on the
 * call row one level up. Nothing is ever taken from a sibling or a neighbouring element.
 */
function identify(
  match: FieldMatch,
  identityField: string,
): { id: string | undefined; presence: ValuePresence } {
  for (const source of [match.row, match.parentRow]) {
    if (!source) continue;
    if (!Object.prototype.hasOwnProperty.call(source, identityField)) continue;
    const raw = source[identityField];
    if (raw === null) return { id: undefined, presence: 'NULL' };
    const id = asIdString(raw);
    return id === undefined ? { id: undefined, presence: 'NULL' } : { id, presence: 'PRESENT' };
  }
  return { id: undefined, presence: 'ABSENT' };
}

/**
 * The Phase 4B state ids whose declared `rawValue` equals what came back, on this field.
 *
 * Strictly supplementary. A declaration like `Y | N` describes a range rather than one value and
 * therefore matches nothing here — which is correct: the model provides no single-valued mapping for
 * it, so none is invented. `rawValue` on the observation stays authoritative either way.
 */
function matchStateIds(resource: StateResourceId, field: string, value: unknown): string[] {
  // Only a primitive can be compared with a declared rawValue. An object or array is left
  // uninterpreted rather than stringified — `[object Object]` would match nothing meaningfully, and
  // a coincidental match would be worse than none.
  const asString =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : undefined;
  if (asString === undefined) return [];
  return (vocabulary(resource)?.states ?? [])
    .filter((definition) => definition.field === field && definition.rawValue === asString)
    .map((definition) => definition.stateId);
}

/** The registered observation definition, or a deterministic failure. */
export function requireObservationDefinition(observationId: string): Observation {
  const definition = observationDefinition(observationId);
  if (!definition) {
    throw new StateObservationError(
      `"${observationId}" is not a registered state observation. Declare it in the Phase 4B ` +
        'catalogue with its provenance — an arbitrary endpoint/field pair is never accepted here, ' +
        `known ids: ${STATE_OBSERVATIONS.map((o) => o.observationId).join(', ')}`,
    );
  }
  return definition;
}

/**
 * Extracts observations from a parsed response body.
 *
 * @param body    the already-parsed response. Not stored, not copied into the results.
 * @param context which definition to apply, and how to trace the result back to the evidence.
 */
export function observeBody(body: unknown, context: ObservationContext): StateObservation[] {
  const definition = requireObservationDefinition(context.observationId);
  const resourceVocabulary = vocabulary(definition.resource);
  if (!resourceVocabulary) {
    throw new StateObservationError(
      `observation "${definition.observationId}" names resource "${definition.resource}", which has ` +
        'no vocabulary — the State Model and this extractor have drifted',
    );
  }

  const path = parseFieldPath(definition.fieldPath);
  const observedAt = context.observedAt ?? new Date().toISOString();
  const identityField = resourceVocabulary.identity.field;
  const parentField = resourceVocabulary.identity.parentField;

  return resolveFieldPath(body, path).map((match) => {
    const identity = identify(match, identityField);
    const parentId = parentField
      ? asIdString(match.parentRow?.[parentField] ?? match.row[parentField])
      : undefined;

    return {
      observationId: definition.observationId,
      resource: definition.resource,
      ...(identity.id !== undefined ? { resourceId: identity.id } : {}),
      ...(parentId !== undefined ? { parentResourceId: parentId } : {}),
      identityPresence: identity.presence,
      stateKey: match.field,
      fieldPath: definition.fieldPath,
      location: match.location,
      presence: match.presence,
      rawValue: match.value,
      matchedStateIds: matchStateIds(definition.resource, match.field, match.value),
      endpointId: definition.endpointId,
      correlationId: context.correlationId,
      ...(context.runId !== undefined ? { runId: context.runId } : {}),
      ...(context.testCaseId !== undefined ? { testCaseId: context.testCaseId } : {}),
      ...(context.label !== undefined ? { label: context.label } : {}),
      observedAt,
      ...(context.actorId !== undefined ? { actorId: context.actorId } : {}),
    } satisfies StateObservation;
  });
}

/**
 * Convenience over an exchange the bench already holds.
 *
 * A body that did not parse yields **no observations**, not an error and not an empty-value
 * observation: nothing was observable, which is a different fact from "the field was absent" and
 * must not be dressed up as one.
 */
export function observeExchange(
  exchange: ObservableExchange,
  context: Omit<ObservationContext, 'correlationId'> & { correlationId?: string },
): StateObservation[] {
  const parsed = exchange.json();
  if (!parsed.ok) return [];
  return observeBody(parsed.value, {
    ...context,
    correlationId: context.correlationId ?? exchange.correlationId,
    label: context.label ?? exchange.label,
  });
}

/** Every observation definition registered for an endpoint — what a caller can ask this response for. */
export function observationIdsForEndpoint(endpointId: string): string[] {
  return STATE_OBSERVATIONS.filter((candidate) => candidate.endpointId === endpointId).map(
    (candidate) => candidate.observationId,
  );
}

/**
 * Observations whose row carried no identity — explicitly unattributed rather than misattributed.
 *
 * Kept visible rather than dropped: a value nobody can attribute is a fact about the response worth
 * reporting, and silently discarding it would hide a shape change.
 */
export function unidentifiedObservations(
  observations: readonly StateObservation[],
): StateObservation[] {
  return observations.filter((candidate) => candidate.resourceId === undefined);
}

/** Observations for one instance — the usual way a caller consumes a multi-row response. */
export function observationsForResource(
  observations: readonly StateObservation[],
  resourceId: string,
): StateObservation[] {
  return observations.filter((candidate) => candidate.resourceId === resourceId);
}

/** Re-exported so a caller can resolve a state id it matched without importing the model twice. */
export { stateDefinition };
