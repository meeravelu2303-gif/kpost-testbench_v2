/**
 * Documented contradictions between KPOST sources — recorded, never resolved.
 *
 * ## The rule this module exists to enforce
 *
 * When two sources disagree, the registry records **both claims and where each is written down**. It
 * does not pick a winner, does not average them, and does not quietly prefer the newer document.
 * Choosing between them is a product-owner decision; a test bench that made that choice silently
 * would encode an unreviewed assumption and then test against it.
 *
 * Every conflict below was verified against the repository, and each side cites the file and line
 * that records it. Nothing here was inferred from the source documents themselves — those are not in
 * the repository, so the evidence is what the repository says about them.
 */

/** What kind of disagreement it is. */
export const CONFLICT_KINDS = [
  /** Whether a module or capability is in scope at all. */
  'SCOPE',
  /** What the product is required to do. */
  'REQUIREMENT',
  /** What an endpoint's payload, enum or method is. */
  'CONTRACT',
  /** A requirement exists but the API surface to satisfy it does not. */
  'COVERAGE_GAP',
] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

/**
 * Whether anyone has settled it.
 *
 * `UNRESOLVED` is the only value any record currently carries, and that is the honest state: the
 * repository records every one of these as an open question for the owner. `RESOLVED` exists so a
 * future decision can be recorded *with its decision evidence* rather than by deleting the conflict.
 */
export const CONFLICT_STATUSES = ['UNRESOLVED', 'RESOLVED'] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

/** One side of a disagreement: who claims what, and where that claim is recorded. */
export interface ConflictSide {
  /** A `sourceId` from `SOURCE_DOCUMENTS`. */
  sourceId: string;
  /** Section / row / file reference inside that source, as precisely as the repository records it. */
  reference?: string;
  /** The claim, stated in one line. Never adjudicated. */
  claim: string;
}

export interface RequirementConflict {
  conflictId: string;
  kind: ConflictKind;
  status: ConflictStatus;
  /** One line a human can act on. */
  summary: string;
  /** Two or more sides. A conflict with fewer than two sides is not a conflict. */
  sides: readonly ConflictSide[];
  /** Requirement ids this conflict touches, when it touches specific ones. */
  affectedRequirementIds?: readonly string[];
  /** Where in THIS repository the disagreement is recorded, so a reviewer can verify it. */
  recordedIn: readonly string[];
  /** What would settle it. A question for the owner, not a proposed answer. */
  openQuestion?: string;
}

export const DOCUMENTED_CONFLICTS: readonly RequirementConflict[] = [
  {
    conflictId: 'CONF-SCOPE-MODULE-COUNT',
    kind: 'SCOPE',
    status: 'UNRESOLVED',
    summary:
      'The consolidated Full Suite FRD describes four modules and 55 functional requirements; the ' +
      'six per-module FRDs describe six modules and ~165. Both documents exist.',
    sides: [
      {
        sourceId: 'SRC-FULLSUITE-FRD',
        reference: 'whole document (v2.0, 2026-09-05)',
        claim: 'Four modules (Signup & Login, Katchup, Kall, KMail), 55 FRs and 9 BRs.',
      },
      {
        sourceId: 'SRC-FRD-KATCHUP',
        reference: 'the six per-module FRDs as a set (2026-09-16)',
        claim:
          'Six modules including KDirectory, ~165 FRs across the FR-SL / FR-KU / FR-GMSG / FR-GC / ' +
          'FR-GM / FR-KL / FR-KM / FR-KD schemes.',
      },
    ],
    recordedIn: ['CLAUDE.md §4 (lines 103-104)', 'CLAUDE.md §8 entry 2026-09-16 (lines 1748-1761)'],
    openQuestion:
      'Is the Full Suite FRD formally withdrawn, or does it remain binding for anything the ' +
      'per-module FRDs do not restate? Six legacy requirement ids currently depend on the answer.',
  },
  {
    conflictId: 'CONF-SCOPE-KDIRECTORY',
    kind: 'SCOPE',
    status: 'UNRESOLVED',
    summary:
      'KDirectory is out of scope per BRD §4.2 and in scope per its own per-module FRD. Both ' +
      'statements are current; neither has been withdrawn.',
    sides: [
      {
        sourceId: 'SRC-BRD',
        reference: '§4.2',
        claim: 'KDirectory is out of scope.',
      },
      {
        sourceId: 'SRC-FRD-KDIRECTORY',
        reference: 'whole document (v1.0, 2026-09-16)',
        claim:
          'KDirectory is a delivered module with six functional requirements (FR-KD-001..006): ' +
          'listing, search by name, entry details, total count, full profile, launch Katchup/Kall.',
      },
    ],
    affectedRequirementIds: [
      'FR-KD-001',
      'FR-KD-002',
      'FR-KD-003',
      'FR-KD-004',
      'FR-KD-005',
      'FR-KD-006',
    ],
    recordedIn: [
      'CLAUDE.md §1 modules table (line 46 area) and §4 (line 115)',
      'CLAUDE.md §8 entry 2026-09-16 (lines 1766-1768): "§1 still called it out-of-scope per BRD §4.2 — corrected"',
    ],
    openQuestion:
      'Does the later module FRD supersede BRD §4.2 for KDirectory, or was the FRD produced for a ' +
      'module the BRD still excludes? The repository corrected its own §1 but did not obtain a ruling.',
  },
  {
    conflictId: 'CONF-REQ-ACTIVATION-ENDPOINT',
    kind: 'COVERAGE_GAP',
    status: 'UNRESOLVED',
    summary:
      'BR-S01 requires account activation before login, but no activation endpoint exists in any ' +
      'documented API source.',
    sides: [
      {
        sourceId: 'SRC-FULLSUITE-FRD',
        reference: 'BR-S01',
        claim: 'Activation is a separate mandatory step; login before activation must fail.',
      },
      {
        sourceId: 'SRC-WORKBOOK-KPOST-API',
        reference: 'all documented endpoints',
        claim:
          'No activation endpoint is documented. Searching every documented endpoint finds only ' +
          'deactivateAccount and sendAccountDeactivationOtp — the reverse operation.',
      },
    ],
    /*
     * Deliberately NO `affectedRequirementIds`. BR-S01 is a business rule from the Full Suite FRD
     * and is not part of any id scheme this bench registers (FR-*, NFR-*, legacy FR-*). Linking it
     * to the nearest signup-era legacy ids (FR-S11 session management, FR-S12 logout) would be an
     * invented mapping — they are different requirements. The conflict is recorded against its
     * SOURCES, which is where the evidence actually sits.
     */
    recordedIn: ['CLAUDE.md line 4325-4328', 'CLAUDE.md §2 (line 64)'],
    openQuestion:
      'Does activation happen outside the API, is the workbook missing it, or does signup activate ' +
      'immediately (making BR-S01 unimplemented)? All three are consistent with the evidence.',
  },
  {
    conflictId: 'CONF-SCOPE-BUSINESS-TIER-RANGE',
    kind: 'REQUIREMENT',
    status: 'UNRESOLVED',
    summary:
      'The business-tier member ranges overlap: Medium is described as >250–2000 and Large as ' +
      '>1500, so 1501–2000 satisfies both.',
    sides: [
      {
        sourceId: 'SRC-OBSERVED',
        reference: 'signup tier selection, recorded in docs/admin-flow.md',
        claim: 'Medium = >250–2000 members.',
      },
      {
        sourceId: 'SRC-OBSERVED',
        reference: 'signup tier selection, recorded in docs/admin-flow.md',
        claim: 'Large = >1500 members.',
      },
    ],
    recordedIn: ['CLAUDE.md line 2113', 'docs/admin-flow.md'],
    openQuestion:
      'Which tier governs an organisation of 1501–2000 members? The repository flags it as "a ' +
      'possible UI finding" but has not confirmed whether the copy or the rule is wrong.',
  },
  {
    conflictId: 'CONF-CONTRACT-RECALL-PAYLOAD',
    kind: 'CONTRACT',
    status: 'UNRESOLVED',
    summary:
      'The workbook and the live client disagree about the recallMessage payload, and the ' +
      "workbook's value falls outside the documented status enum.",
    sides: [
      {
        sourceId: 'SRC-WORKBOOK-KPOST-API',
        reference: 'recallMessage sample payload',
        claim:
          'recallMessage takes {msgID, status:5} — but 5 is not a valid katchupStatus (the enum ' +
          'stops at 4), so the sample is internally inconsistent with the same workbook’s Types tab.',
      },
      {
        sourceId: 'SRC-UI-CLIENT',
        reference: 'KatchupMessage.js handleRecall',
        claim: 'recallMessage takes {msgID, groupFlag} — no status field at all.',
      },
    ],
    recordedIn: ['CLAUDE.md lines 3569-3570', 'docs/katchup-flow.md §2 item 1'],
    openQuestion:
      'Is the workbook sample stale? The bench follows the live client, but the workbook has not ' +
      'been corrected and remains the declared contract source of truth (CLAUDE.md §7).',
  },
  {
    conflictId: 'CONF-CONTRACT-MESSAGETYPE-2',
    kind: 'CONTRACT',
    status: 'UNRESOLVED',
    summary:
      'Katchup messageType 2 is labelled "Forward" by the client and "Share Message" by the type ' +
      'contract; forward is separately 15/16.',
    sides: [
      {
        sourceId: 'SRC-CONTRACTS-GENERATED',
        reference: 'contracts/kpost-types.json → katchupMessageType',
        claim: 'messageType 2 = Share Message; forward is 15/16.',
      },
      {
        sourceId: 'SRC-UI-CLIENT',
        reference: 'MessageType.js',
        claim: 'messageType 2 renders with the prefix "Forward".',
      },
    ],
    recordedIn: ['CLAUDE.md line 3572', 'docs/katchup-flow.md §2 item 2'],
    openQuestion:
      'Is the display label wrong, or is the type contract mislabelled? The repository treats the ' +
      'send codes as authoritative but records this as unconfirmed.',
  },
  {
    conflictId: 'CONF-REQ-SUBJECT-EMPTY',
    kind: 'REQUIREMENT',
    status: 'UNRESOLVED',
    summary:
      'A Subject is required on every Katchup message, but the client enforces it by defaulting to ' +
      '"General" rather than by blocking — so whether the API rejects an empty subject is unknown.',
    sides: [
      {
        sourceId: 'SRC-FRD-KATCHUP',
        reference: 'FR-KU subject requirement (Full Suite: FR-K02 / BR-K01)',
        claim: 'Every message, 1:1 and group alike, carries a Subject.',
      },
      {
        sourceId: 'SRC-UI-CLIENT',
        reference: 'WriteMessage.js / KatchupMessage.js',
        claim:
          'The client never sends an empty subject: `subject == null || "" ? "General"`. The rule ' +
          'is satisfied by defaulting, so the API-side rule is never exercised by the product.',
      },
    ],
    recordedIn: ['docs/katchup-flow.md §2 item 3'],
    openQuestion:
      'Is an empty subject meant to be rejected by the API, or is defaulting to "General" the ' +
      'intended behaviour? The bench sends an empty subject directly to find out.',
  },
  {
    conflictId: 'CONF-CONTRACT-WORKBOOK-VS-LIVE',
    kind: 'CONTRACT',
    status: 'UNRESOLVED',
    summary:
      'For several endpoints the workbook’s documented path or method disagrees with the live ' +
      'application, and the bench calls the live one while reading the schema from the documented row.',
    sides: [
      {
        sourceId: 'SRC-WORKBOOK-KPOST-API',
        reference: 'the documented method+path rows',
        claim:
          'The workbook is the contract source of truth (CLAUDE.md §7) and states the method and ' +
          'path for every endpoint.',
      },
      {
        sourceId: 'SRC-OBSERVED',
        reference: 'live probing recorded in CLAUDE.md §8',
        claim:
          'The live application answers a different path or verb for some endpoints — the company-' +
          'logo trio needed a /v2 prefix the workbook omits, and two profile reads answer only GET ' +
          'where the workbook documents POST. The definitions carry contractPath / contractMethod ' +
          'to record both.',
      },
    ],
    recordedIn: [
      'src/api/registry/endpoint-definition.ts (contractPath, contractMethod fields)',
      'CLAUDE.md §8 entries 2026-09-12 and 2026-09-13',
    ],
    openQuestion:
      'Should the workbook be corrected so the documented and live contracts agree? Until it is, ' +
      'two sources describe the same endpoint differently and the bench records both.',
  },
];

const BY_CONFLICT_ID = new Map(DOCUMENTED_CONFLICTS.map((c) => [c.conflictId, c]));

/** A conflict by id. */
export function conflict(conflictId: string): RequirementConflict | undefined {
  return BY_CONFLICT_ID.get(conflictId);
}

/** Every conflict touching a requirement id. */
export function conflictsForRequirement(requirementId: string): RequirementConflict[] {
  return DOCUMENTED_CONFLICTS.filter((c) =>
    (c.affectedRequirementIds ?? []).includes(requirementId),
  );
}

/** Every conflict naming a source id on either side. */
export function conflictsForSource(sourceId: string): RequirementConflict[] {
  return DOCUMENTED_CONFLICTS.filter((c) => c.sides.some((side) => side.sourceId === sourceId));
}
