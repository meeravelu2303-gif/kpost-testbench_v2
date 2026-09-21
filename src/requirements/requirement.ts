import type { SourceAuthority, SourceType } from './source';

/**
 * WHAT the product requires, and WHERE that requirement came from.
 *
 * Phase 1 of the requirement architecture — a provenance record, nothing more. A `RequirementRecord`
 * carries identity, source, status and conflict links. It deliberately carries no flow, no actor, no
 * state, no invariant and no test wiring: those are later phases, and putting a hook for them here
 * would couple the provenance layer to execution before anyone has designed it.
 *
 * ## The boundary this type defends
 *
 *     Requirement Registry  =  WHAT is required  +  WHERE it is written down
 *     NOT                   =  how it is executed, validated, tested, filed or scored
 */

/**
 * The lifecycle of a requirement, as the repository can actually evidence it.
 *
 * The smallest vocabulary that fits: `DEPRECATED` is deliberately absent because this repository
 * records no deprecation concept distinct from supersession — every retired requirement here was
 * retired by a newer document, which is exactly `SUPERSEDED`. Adding an unused member would invite
 * two ways to say the same thing.
 */
export const REQUIREMENT_STATUSES = [
  /** Defined by a current source and not contradicted. */
  'ACTIVE',
  /** Its defining document was replaced by a newer one. `supersededBy` names the successor(s). */
  'SUPERSEDED',
  /** Two documented sources disagree about it and the repository has not resolved which governs. */
  'CONFLICTED',
  /** Referenced by the repository, but the defining document or section is not recorded. */
  'UNVERIFIED',
  /** Nothing in the repository establishes its state. */
  'UNKNOWN',
] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

/**
 * One requirement, with its provenance.
 *
 * Text fields are optional on purpose. The requirement prose lives in documents outside this
 * repository (8 KB–21 MB `.docx`), and the per-FR titles live in `docs/requirements-frd.md`.
 * Transcribing either into code would create a second copy that drifts from the original, so a
 * record stores the pointer (`sourceId` + `reference`) and leaves the text to the named source.
 * Where the repository itself states a requirement in one line, that line is carried as
 * `normalizedRequirementText` and its origin cited in `provenanceNotes`.
 */
export interface RequirementRecord {
  /** The id the repository already uses, e.g. `FR-KU-017`, `NFR-SEC02`, `FR-K07`. */
  requirementId: string;
  /** The document that defines it — a `sourceId` from `SOURCE_DOCUMENTS`. */
  sourceId: string;
  sourceType: SourceType;
  sourceName: string;
  sourceVersion?: string;
  sourceDate?: string;
  /** Section / requirement-id reference inside that document, as precisely as the repo records it. */
  reference?: string;

  /** Verbatim wording from the source document. Absent whenever the source is not in-repository. */
  originalRequirementText?: string;
  /** A concise restatement the repository itself records. Absent when the repository records none. */
  normalizedRequirementText?: string;

  /** Inherited from the defining source unless the repository records otherwise. */
  authority: SourceAuthority;
  status: RequirementStatus;

  /** Requirement ids this one replaces. */
  supersedes?: readonly string[];
  /** Requirement ids that replace this one. Empty on a superseded record means no successor exists. */
  supersededBy?: readonly string[];
  /** Conflict ids from `DOCUMENTED_CONFLICTS` that involve this requirement. */
  conflictsWith?: readonly string[];

  /** Why this record says what it says — repository citations, never opinion. */
  provenanceNotes?: readonly string[];
}

/**
 * A requirement whose defining document was superseded and for which no successor id exists.
 *
 * Not a separate status: the state is fully described by `SUPERSEDED` plus an empty `supersededBy`.
 * Exposed as a predicate so a guard can report the set without inventing vocabulary for it.
 */
export function isOrphanedRequirement(record: RequirementRecord): boolean {
  return record.status === 'SUPERSEDED' && (record.supersededBy?.length ?? 0) === 0;
}

/** Whether the repository records any concise text for a requirement. */
export function hasRequirementText(record: RequirementRecord): boolean {
  return Boolean(record.originalRequirementText ?? record.normalizedRequirementText);
}
