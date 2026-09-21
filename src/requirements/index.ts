/**
 * The Requirement Source Registry — WHAT the product requires and WHERE that requirement came from.
 *
 * Phase 1 of the requirement architecture, and a **provenance layer only**. It answers:
 *
 *   1. What is the requirement?            `RequirementRecord.requirementId` (+ concise text where recorded)
 *   2. Which document defines it?          `sourceId` → `SOURCE_DOCUMENTS`
 *   3. Which version / date?               `sourceVersion`, `sourceDate`
 *   4. Which section identifies it?        `reference`
 *   5. What type of source is it?          `sourceType` (BRD / MODULE_FRD / OPENAPI / …)
 *   6. What authority does it carry?       `authority` (AUTHORITATIVE / SECONDARY / DERIVED / …)
 *   7. Is it current or superseded?        `status` (ACTIVE / SUPERSEDED / CONFLICTED / …)
 *   8. Does it conflict with another?      `conflictsWith` → `DOCUMENTED_CONFLICTS`
 *   9. What provenance confidence?         the status + authority pair, plus `provenanceNotes`
 *
 * ## What this layer must never become
 *
 * Not endpoint execution, not validation, not test implementation, not business-rule execution, not
 * confidence logic, not Bugzilla logic. It imports none of them, and `traceability.ts` takes its
 * inputs as arguments precisely so it cannot start.
 *
 * ## What is deliberately absent
 *
 * No flow, actor, state, invariant or scenario model. Those are later phases. This layer stops at
 * "who requires it and who says so".
 *
 * ## Relationship to what already existed
 *
 * `src/config/frd-requirements.ts` remains the canonical ID set and is unmodified; this registry
 * imports it and attaches provenance, with a guard asserting the two can never diverge.
 * `docs/requirements-frd.md` remains the human-readable FR→coverage map.
 * `EndpointDefinition.requirements` remains the endpoint→requirement mapping, unmodified.
 */

export {
  SOURCE_AUTHORITIES,
  SOURCE_DOCUMENTS,
  SOURCE_TYPES,
  sourceDocument,
  sourceIds,
  sourcesOfType,
  type SourceAuthority,
  type SourceDocument,
  type SourceType,
} from './source';

export {
  REQUIREMENT_STATUSES,
  hasRequirementText,
  isOrphanedRequirement,
  type RequirementRecord,
  type RequirementStatus,
} from './requirement';

export {
  CONFLICT_KINDS,
  CONFLICT_STATUSES,
  DOCUMENTED_CONFLICTS,
  conflict,
  conflictsForRequirement,
  conflictsForSource,
  type ConflictKind,
  type ConflictSide,
  type ConflictStatus,
  type RequirementConflict,
} from './conflicts';

export {
  allRequirements,
  hasRequirement,
  isRegisteredRequirementId,
  provenanceSummary,
  requirement,
  requirementsFromSource,
  requirementsWithStatus,
  type ProvenanceSummary,
} from './registry';

export {
  TEST_CASE_TRACEABILITY_GAP,
  endpointsByRequirement,
  traceEndpoint,
  untracedRequirementIds,
  type EndpointRequirementTrace,
  type RequirementTaggedEndpoint,
} from './traceability';
