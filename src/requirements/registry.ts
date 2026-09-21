import { FR_IDS, LEGACY_REQUIREMENTS, NFR_IDS, isKnownRequirement } from '@config/frd-requirements';
import { DOCUMENTED_CONFLICTS, conflictsForRequirement } from './conflicts';
import type { RequirementRecord, RequirementStatus } from './requirement';
import { sourceDocument, type SourceDocument } from './source';

/**
 * The Requirement Source Registry — every requirement id the bench knows, with its provenance.
 *
 * ## Why this DERIVES from the existing id registry instead of restating it
 *
 * `src/config/frd-requirements.ts` already owns the canonical id set (`FR_IDS`, `NFR_IDS`,
 * `LEGACY_REQUIREMENTS`) and is already enforced against every endpoint by
 * `tests/framework/requirements-traceability.spec.ts`. Re-listing those ids here would create a
 * second competing registry that drifts silently the moment one is edited.
 *
 * So this module imports them and attaches PROVENANCE, and a guard
 * (`tests/framework/requirement-registry.spec.ts`) asserts the two sets are identical in both
 * directions. `frd-requirements.ts` is not modified by this phase: the existing guard, the existing
 * endpoint tags and the existing coverage document keep working exactly as before.
 *
 * ## What a record's source is, and how that is decided
 *
 * By id prefix, which is how the requirement schemes were assigned in the first place — each of the
 * six per-module FRDs owns one or two prefixes (CLAUDE.md §8, 2026-09-16). Nothing is guessed: an id
 * whose prefix is not mapped produces an `UNVERIFIED` record rather than a default source.
 */

/**
 * Requirement-id prefix → the document that defines that scheme.
 *
 * Longest prefix wins, so `FR-GMSG` resolves before a hypothetical `FR-G`. Taken verbatim from the
 * scheme table in CLAUDE.md §8 (2026-09-16).
 */
const SOURCE_BY_PREFIX: readonly (readonly [string, string])[] = [
  ['FR-SL-', 'SRC-FRD-SIGNUP-LOGIN'],
  ['FR-GMSG-', 'SRC-FRD-KATCHUP'],
  ['FR-KU-', 'SRC-FRD-KATCHUP'],
  ['FR-GC-', 'SRC-FRD-GROUP'],
  ['FR-GM-', 'SRC-FRD-GROUP'],
  ['FR-KL-', 'SRC-FRD-KALL'],
  ['FR-KM-', 'SRC-FRD-KMAIL'],
  ['FR-KD-', 'SRC-FRD-KDIRECTORY'],
];

/** The section reference for a module-FRD requirement: the FR scheme is the document's own index. */
const FR_SCHEME_REFERENCE = 'functional-requirement index of the module FRD';

/**
 * One-line restatements the REPOSITORY itself records, with the citation.
 *
 * These are carried because the repository states them in a single line — not transcribed from the
 * source documents, which are external and are never copied. Every other requirement's text stays
 * in its named source; `docs/requirements-frd.md` holds the per-FR titles and is the human-readable
 * companion to this registry.
 */
const REPOSITORY_STATED_TEXT: Readonly<Record<string, { text: string; citation: string }>> = {
  'NFR-SEC01': {
    text: 'A JWT is required on authenticated operations.',
    citation: 'CLAUDE.md §4 — mapped onto the authentication validators',
  },
  'NFR-SEC02': {
    text: 'A confidential copy is invisible to the other recipients of the message.',
    citation: 'CLAUDE.md §4 — mapped onto cross-resource access',
  },
  'NFR-SEC03': {
    text: 'Passwords must satisfy the platform strength rules.',
    citation: 'CLAUDE.md §4 — mapped onto the request validators',
  },
  'NFR-R01': {
    text: 'The authentication service must be available to every module that depends on it.',
    citation: 'CLAUDE.md §3 and §4 — the auth service sits outside the service registry',
  },
  'NFR-R02': {
    text: 'A dependent-service failure must not cause silent data loss.',
    citation: 'CLAUDE.md §4',
  },
  'NFR-P01': {
    text: 'Message latency must stay within the documented budget.',
    citation: 'CLAUDE.md §4 — mapped onto the response-time budget, not load testing',
  },
  'FR-K07': {
    text: 'Katchup unread-count and read-receipt reads.',
    citation: 'src/config/frd-requirements.ts LEGACY_REQUIREMENTS comment',
  },
  'FR-M02': {
    text: 'KMail draft handling.',
    citation: 'src/config/frd-requirements.ts LEGACY_REQUIREMENTS comment',
  },
  'FR-M07': {
    text: 'KMail delete.',
    citation: 'src/config/frd-requirements.ts LEGACY_REQUIREMENTS comment',
  },
  'FR-S05': {
    text: 'Company-logo upload, download and removal.',
    citation: 'src/config/frd-requirements.ts LEGACY_REQUIREMENTS comment',
  },
  'FR-S11': {
    text: 'Active session, login history and access code.',
    citation: 'src/config/frd-requirements.ts LEGACY_REQUIREMENTS comment',
  },
  'FR-S12': {
    text: 'Logout, and logout from all devices.',
    citation: 'src/config/frd-requirements.ts LEGACY_REQUIREMENTS comment',
  },
};

/** The source document that defines an id's scheme, or `undefined` when no prefix matches. */
function sourceForRequirement(requirementId: string): SourceDocument | undefined {
  const match = [...SOURCE_BY_PREFIX]
    .filter(([prefix]) => requirementId.startsWith(prefix))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match ? sourceDocument(match[1]) : undefined;
}

function textFor(
  requirementId: string,
): Pick<RequirementRecord, 'normalizedRequirementText' | 'provenanceNotes'> {
  const stated = REPOSITORY_STATED_TEXT[requirementId];
  if (!stated) return {};
  return {
    normalizedRequirementText: stated.text,
    provenanceNotes: [`Concise restatement recorded in this repository: ${stated.citation}.`],
  };
}

/**
 * Links a record to any conflict naming it, and decides the status when both could apply.
 *
 * ## Status precedence, stated rather than accidental
 *
 * A requirement can be both superseded and disputed. `status` is a single lifecycle value, so one
 * must win, and the rule is: **SUPERSEDED outranks CONFLICTED**. Supersession is the more specific
 * statement — it says this id is no longer the current way to express the requirement at all, which
 * is true regardless of whether its old document is also disputed. Overwriting it with CONFLICTED
 * would lose that, and `supersededBy` alone does not convey it.
 *
 * `conflictsWith` is populated either way, because the LINK is a fact independent of the status.
 */
function withConflicts(record: RequirementRecord): RequirementRecord {
  const ids = conflictsForRequirement(record.requirementId).map((c) => c.conflictId);
  if (ids.length === 0) return record;
  const keepsStatus = record.status === 'SUPERSEDED';
  return {
    ...record,
    conflictsWith: ids,
    status: keepsStatus ? record.status : 'CONFLICTED',
    provenanceNotes: [
      ...(record.provenanceNotes ?? []),
      `Subject of documented conflict(s): ${ids.join(', ')}. The registry records both sides and resolves neither.` +
        (keepsStatus
          ? ' Status stays SUPERSEDED because supersession is the more specific statement about this id.'
          : ''),
    ],
  };
}

/** Builds the record for one current functional-requirement id. */
function currentFrRecord(requirementId: string): RequirementRecord {
  const source = sourceForRequirement(requirementId);
  if (!source) {
    return withConflicts({
      requirementId,
      sourceId: 'UNKNOWN',
      sourceType: 'OTHER',
      sourceName: 'unmapped requirement-id prefix',
      authority: 'UNKNOWN',
      status: 'UNVERIFIED',
      provenanceNotes: [
        'No entry in SOURCE_BY_PREFIX matches this id, so its defining document is not established. ' +
          'Recorded as unverified rather than attributed to a default source.',
      ],
      ...textFor(requirementId),
    });
  }
  return withConflicts({
    requirementId,
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    sourceName: source.sourceName,
    ...(source.sourceVersion ? { sourceVersion: source.sourceVersion } : {}),
    ...(source.sourceDate ? { sourceDate: source.sourceDate } : {}),
    reference: FR_SCHEME_REFERENCE,
    authority: source.authority,
    status: 'ACTIVE',
    ...textFor(requirementId),
  });
}

/**
 * Builds the record for a non-functional-requirement id.
 *
 * The NFR ids are referenced throughout the repository and mapped onto validators (CLAUDE.md §4),
 * but **no document is named as their definition**. They are therefore `UNVERIFIED` with an
 * `UNKNOWN` source rather than being attributed to the BRD or SRS on a guess.
 */
function nfrRecord(requirementId: string): RequirementRecord {
  return withConflicts({
    requirementId,
    sourceId: 'UNKNOWN',
    sourceType: 'OTHER',
    sourceName: 'not recorded — the defining document for the NFR scheme is not named',
    authority: 'UNKNOWN',
    status: 'UNVERIFIED',
    ...textFor(requirementId),
    provenanceNotes: [
      ...(textFor(requirementId).provenanceNotes ?? []),
      'CLAUDE.md §4 lists this NFR and the validators it maps onto, but names no defining document ' +
        'or section. Attributing it to the BRD, PRD, SRS or FSD would be a guess, so the source is ' +
        'left UNKNOWN and the status UNVERIFIED. Resolving this needs the owner to name the document.',
    ],
  });
}

/**
 * Builds the record for a legacy id from the superseded Full Suite FRD.
 *
 * `supersededBy` is deliberately EMPTY: `frd-requirements.ts` records that each of these "have NO
 * clean equivalent in the new per-module scheme", so claiming a successor would be an invented
 * mapping. The empty array plus `SUPERSEDED` is exactly the orphaned state, and
 * `isOrphanedRequirement()` names it.
 */
function legacyRecord(requirementId: string): RequirementRecord {
  const source = sourceDocument('SRC-FULLSUITE-FRD');
  return withConflicts({
    requirementId,
    sourceId: 'SRC-FULLSUITE-FRD',
    sourceType: source?.sourceType ?? 'FULL_SUITE_FRD',
    sourceName: source?.sourceName ?? 'KPOST_FullSuite_FRD.docx',
    ...(source?.sourceVersion ? { sourceVersion: source.sourceVersion } : {}),
    ...(source?.sourceDate ? { sourceDate: source.sourceDate } : {}),
    reference: 'Full Suite FRD requirement index',
    authority: source?.authority ?? 'SECONDARY',
    status: 'SUPERSEDED',
    supersededBy: [],
    ...textFor(requirementId),
    provenanceNotes: [
      ...(textFor(requirementId).provenanceNotes ?? []),
      'Its defining document was superseded on 2026-09-16, and the per-module FRDs define no ' +
        'equivalent id — so this requirement has no successor. It is still tagged on live endpoint ' +
        'definitions, which is why it remains registered rather than deleted.',
    ],
  });
}

/** Every requirement record, built once at import. Pure data — no I/O, no clock, no randomness. */
const RECORDS: readonly RequirementRecord[] = [
  ...FR_IDS.map(currentFrRecord),
  ...NFR_IDS.map(nfrRecord),
  ...LEGACY_REQUIREMENTS.map(legacyRecord),
];

const BY_REQUIREMENT_ID = new Map(RECORDS.map((record) => [record.requirementId, record]));

/** Every registered requirement record. */
export function allRequirements(): readonly RequirementRecord[] {
  return RECORDS;
}

/** One requirement's provenance, or `undefined` when the id is not registered. */
export function requirement(requirementId: string): RequirementRecord | undefined {
  return BY_REQUIREMENT_ID.get(requirementId);
}

/** Whether the registry holds a record for this id. Mirrors `isKnownRequirement` by construction. */
export function hasRequirement(requirementId: string): boolean {
  return BY_REQUIREMENT_ID.has(requirementId);
}

/** Requirements in one lifecycle state. */
export function requirementsWithStatus(status: RequirementStatus): RequirementRecord[] {
  return RECORDS.filter((record) => record.status === status);
}

/** Requirements defined by one source document. */
export function requirementsFromSource(sourceId: string): RequirementRecord[] {
  return RECORDS.filter((record) => record.sourceId === sourceId);
}

/**
 * A summary of the registry's own provenance health — what is solid and what is not.
 *
 * Reported by a guard rather than asserted to any particular value: these counts are a measurement
 * of the documentation, and they should move when the documentation is corrected, not be pinned.
 */
export interface ProvenanceSummary {
  total: number;
  byStatus: Record<RequirementStatus, number>;
  /** Registered ids whose defining document is not established. */
  withoutSource: number;
  /** Registered ids for which the repository records no concise text. */
  withoutText: number;
  /** Superseded ids with no successor. */
  orphaned: number;
  conflicts: number;
}

export function provenanceSummary(): ProvenanceSummary {
  const byStatus = { ACTIVE: 0, SUPERSEDED: 0, CONFLICTED: 0, UNVERIFIED: 0, UNKNOWN: 0 };
  for (const record of RECORDS) byStatus[record.status] += 1;
  return {
    total: RECORDS.length,
    byStatus,
    withoutSource: RECORDS.filter((r) => r.sourceId === 'UNKNOWN').length,
    withoutText: RECORDS.filter((r) => !(r.originalRequirementText ?? r.normalizedRequirementText))
      .length,
    orphaned: RECORDS.filter(
      (r) => r.status === 'SUPERSEDED' && (r.supersededBy?.length ?? 0) === 0,
    ).length,
    conflicts: DOCUMENTED_CONFLICTS.length,
  };
}

/**
 * The ids the existing id registry knows — re-exported so a caller never has to import both modules
 * and risk asking one of them a question the other answers differently.
 */
export function isRegisteredRequirementId(id: string): boolean {
  return isKnownRequirement(id);
}
