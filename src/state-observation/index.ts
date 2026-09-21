/**
 * The State Observation Foundation — reading application state out of a captured response.
 *
 * Phase 4C. The first bridge between the response/evidence infrastructure that already exists and
 * the declarative State Model from Phase 4B:
 *
 *     captured exchange  ──►  Phase 4B observation definition  ──►  StateObservation
 *     (correlationId)         (endpoint + field path)              (resource id + raw value)
 *
 * ## The boundary
 *
 * This layer records **what the application returned**. It never decides whether that value is
 * correct. It contains no expectation, no comparison, no pass/fail, no business rule, no
 * authorization, no classification, no confidence and nothing to do with Bugzilla — and framework
 * guards assert each of those absences rather than trusting review.
 *
 * It is also read-only: it sends no request, and mutates no flow run, no resource ledger and no
 * application state.
 *
 * ## It is not a second evidence system
 *
 * The captured `ExchangeEvidence` remains the single record of a response, with Phase 3.2's masking
 * and bounds intact. An observation carries a `correlationId` REFERENCE to it and never a copy of
 * the body, so no unmasked duplicate of the response comes into existence here.
 */

export {
  FieldPathError,
  parseFieldPath,
  resolveFieldPath,
  type FieldMatch,
  type ParsedFieldPath,
  type PathSegment,
  type ValuePresence,
} from './path';

export { FORBIDDEN_RESULT_KEYS, type StateObservation } from './observation-result';

export {
  StateObservationError,
  observationIdsForEndpoint,
  observationsForResource,
  observeBody,
  observeExchange,
  requireObservationDefinition,
  unidentifiedObservations,
  type ObservableExchange,
  type ObservationContext,
} from './extract';
