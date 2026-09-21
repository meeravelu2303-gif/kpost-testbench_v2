/**
 * WHERE a requirement came from — the source documents, their kind and their authority.
 *
 * Phase 1 of the requirement architecture. This module is a **provenance layer only**: it records
 * which document states a requirement, which version of it, and how much weight that document
 * carries. It contains no execution logic, no validation, no test wiring, no defect logic, and it
 * imports nothing from the engine, the validators, the reporters or the bug tracker.
 *
 * ## What is deliberately NOT here
 *
 * No flow, actor, state or invariant model. Those are later phases and would couple this layer to
 * execution. A source record answers "who says so, and how strongly", and stops.
 *
 * ## Why the documents are identified rather than copied
 *
 * The eleven KPOST specification documents live outside the repository (`D:\Kpost Documents`) and
 * range from 15 KB to 21 MB — mostly images. Copying their prose into the repository would create a
 * second copy that drifts from the originals and from `docs/requirements-frd.md`. So this registry
 * stores **identity and traceability metadata** (name, version, date, kind, authority), never
 * content. A reader who needs the wording opens the named document at the named section.
 */

/**
 * The kinds of source this product's requirements actually come from.
 *
 * Every member is backed by a document or artefact that exists — nothing here is speculative. The
 * repository evidence for each is named in `SOURCE_DOCUMENTS` below.
 */
export const SOURCE_TYPES = [
  /** Business Requirements Document — business case, module scope. */
  'BRD',
  /** Product Requirements Document. */
  'PRD',
  /** Software Requirements Specification — architecture and non-functional context. */
  'SRS',
  /** Functional Specification Document. */
  'FSD',
  /** The consolidated Full Suite FRD (four modules), superseded 2026-09-16. */
  'FULL_SUITE_FRD',
  /** One of the six standalone per-module FRDs that superseded the Full Suite FRD. */
  'MODULE_FRD',
  /** An owner-supplied workbook/PDF enumerating API endpoints and payloads. */
  'REQUIREMENT_WORKBOOK',
  /** A generated contract file under `contracts/`. */
  'API_CONTRACT',
  /** A generated OpenAPI document under `openapi/`. */
  'OPENAPI',
  /** The authoritative front-end client, used as the specification for payloads and screens. */
  'UI_SPECIFICATION',
  /** Behaviour established by probing the running application and recorded in the decision log. */
  'OBSERVED_APPLICATION_BEHAVIOUR',
  /** Anything that does not fit the above. Prefer a precise type; this is an escape hatch. */
  'OTHER',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * How much weight a source carries — recorded explicitly so the registry never has to *decide*.
 *
 * The vocabulary mirrors the shape the rest of this repository already uses for closed judgement
 * sets (`APPLICATION | EDGE | NO_RESPONSE | UNKNOWN`, `PRESENT | ABSENT | UNKNOWN`): UPPER_SNAKE,
 * closed, and carrying an explicit `UNKNOWN` rather than defaulting to a guess.
 *
 * Deliberately NOT a numeric score. A number invites arithmetic between incommensurable things and
 * hides the reason; a named level forces the reason into `authorityReason`.
 */
export const SOURCE_AUTHORITIES = [
  /** The document the product owner treats as definitive for its subject. */
  'AUTHORITATIVE',
  /** Real, but outranked for its subject by an authoritative source. */
  'SECONDARY',
  /** Mechanically generated from another source; it inherits, never creates, authority. */
  'DERIVED',
  /** Established by watching the running application, not by any document. */
  'OBSERVED',
  /** The repository does not record how much weight this source carries. */
  'UNKNOWN',
  /** Two sources claim authority over the same subject and the repository has not resolved it. */
  'CONFLICTED',
] as const;
export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];

/** One source document, identified but never copied. */
export interface SourceDocument {
  /** Stable id used by requirement records and conflict records. */
  sourceId: string;
  sourceType: SourceType;
  /** The document's name as the repository refers to it. */
  sourceName: string;
  /** Version as stated in the document's own name, when it states one. */
  sourceVersion?: string;
  /** ISO date of the document as it exists on disk, when known. */
  sourceDate?: string;
  /** Where the document lives, as the repository records it. Never its contents. */
  location: string;
  authority: SourceAuthority;
  /** Why this authority level — the repository evidence, cited. Never an opinion. */
  authorityReason: string;
  /** Present when this document has been superseded; names the successor source ids. */
  supersededBy?: readonly string[];
  /** Present when this document superseded others. */
  supersedes?: readonly string[];
  /** Whether the artefact is inside this repository or external to it. */
  inRepository: boolean;
}

/** The documented folder holding the KPOST specification set, as CLAUDE.md §1 records it. */
const SPEC_FOLDER = 'D:\\Kpost Documents';

/**
 * Every source the repository actually cites, with its provenance.
 *
 * Dates and sizes were read from disk on 2026-09-20: the five consolidated documents are dated
 * 2026-09-05 and the six per-module FRDs 2026-09-16, which is the supersession evidence recorded in
 * `CLAUDE.md` §4 and §8 ("**Source of truth (2026-09-16): the six per-module FRDs** … These
 * supersede the old FullSuite FRD (55 FRs/4 modules)").
 */
export const SOURCE_DOCUMENTS: readonly SourceDocument[] = [
  // ---- The consolidated specification set (2026-09-05) ----------------------------------------
  {
    sourceId: 'SRC-BRD',
    sourceType: 'BRD',
    sourceName: 'KPOST_BRD.docx',
    sourceDate: '2026-09-05',
    location: SPEC_FOLDER,
    authority: 'AUTHORITATIVE',
    authorityReason:
      'CLAUDE.md §1 names it a source of truth for the product definition, and §4.2 of this ' +
      'document is what the repository cites when it declares a module out of scope.',
    inRepository: false,
  },
  {
    sourceId: 'SRC-PRD',
    sourceType: 'PRD',
    sourceName: 'KPOST_PRD.docx',
    sourceDate: '2026-09-05',
    location: SPEC_FOLDER,
    authority: 'AUTHORITATIVE',
    authorityReason: 'CLAUDE.md §1 lists it in the source-of-truth set for the product definition.',
    inRepository: false,
  },
  {
    sourceId: 'SRC-SRS',
    sourceType: 'SRS',
    sourceName: 'KPOST_SRS.docx',
    sourceDate: '2026-09-05',
    location: SPEC_FOLDER,
    authority: 'AUTHORITATIVE',
    authorityReason:
      'CLAUDE.md §3 cites SRS §4.2 as the basis for the documented platform weaknesses ' +
      '(shared database, circular KMail/Katchup dependency, auth outside the registry).',
    inRepository: false,
  },
  {
    sourceId: 'SRC-FSD',
    sourceType: 'FSD',
    sourceName: 'KPOST_FSD.docx',
    sourceDate: '2026-09-05',
    location: SPEC_FOLDER,
    authority: 'AUTHORITATIVE',
    authorityReason: 'CLAUDE.md §1 lists it in the source-of-truth set for the product definition.',
    inRepository: false,
  },
  {
    sourceId: 'SRC-FULLSUITE-FRD',
    sourceType: 'FULL_SUITE_FRD',
    sourceName: 'KPOST_FullSuite_FRD.docx',
    sourceVersion: 'v2.0',
    sourceDate: '2026-09-05',
    location: SPEC_FOLDER,
    authority: 'SECONDARY',
    authorityReason:
      'Superseded on 2026-09-16 by the six per-module FRDs (CLAUDE.md §4). It remains the ONLY ' +
      'source for the six legacy requirement ids that have no successor in the current scheme, ' +
      'so it is SECONDARY rather than withdrawn.',
    supersededBy: [
      'SRC-FRD-SIGNUP-LOGIN',
      'SRC-FRD-KATCHUP',
      'SRC-FRD-GROUP',
      'SRC-FRD-KALL',
      'SRC-FRD-KMAIL',
      'SRC-FRD-KDIRECTORY',
    ],
    inRepository: false,
  },

  // ---- The six per-module FRDs (2026-09-16) — the current requirement source of truth ---------
  {
    sourceId: 'SRC-FRD-SIGNUP-LOGIN',
    sourceType: 'MODULE_FRD',
    sourceName: 'KPOST_FRD_Module1_SignupLogin_v1.7.docx',
    sourceVersion: 'v1.7',
    sourceDate: '2026-09-16',
    location: SPEC_FOLDER,
    authority: 'AUTHORITATIVE',
    authorityReason: 'CLAUDE.md §4: the six per-module FRDs are the requirement source of truth.',
    supersedes: ['SRC-FULLSUITE-FRD'],
    inRepository: false,
  },
  {
    sourceId: 'SRC-FRD-KATCHUP',
    sourceType: 'MODULE_FRD',
    sourceName: 'KPOST_FRD_Katchup_v1.9.docx',
    sourceVersion: 'v1.9',
    sourceDate: '2026-09-16',
    location: SPEC_FOLDER,
    authority: 'AUTHORITATIVE',
    authorityReason:
      'CLAUDE.md §4: source of truth. Its §8 also defines the FR-GMSG Group-Messaging sub-scheme.',
    supersedes: ['SRC-FULLSUITE-FRD'],
    inRepository: false,
  },
  {
    sourceId: 'SRC-FRD-GROUP',
    sourceType: 'MODULE_FRD',
    sourceName: 'KPOST_FRD_Group_v1.0.docx',
    sourceVersion: 'v1.0',
    sourceDate: '2026-09-16',
    location: SPEC_FOLDER,
    authority: 'AUTHORITATIVE',
    authorityReason: 'CLAUDE.md §4: the six per-module FRDs are the requirement source of truth.',
    supersedes: ['SRC-FULLSUITE-FRD'],
    inRepository: false,
  },
  {
    sourceId: 'SRC-FRD-KALL',
    sourceType: 'MODULE_FRD',
    sourceName: 'KPOST_FRD_Module3_Kall_v1.0.docx',
    sourceVersion: 'v1.0',
    sourceDate: '2026-09-16',
    location: SPEC_FOLDER,
    authority: 'AUTHORITATIVE',
    authorityReason: 'CLAUDE.md §4: the six per-module FRDs are the requirement source of truth.',
    supersedes: ['SRC-FULLSUITE-FRD'],
    inRepository: false,
  },
  {
    sourceId: 'SRC-FRD-KMAIL',
    sourceType: 'MODULE_FRD',
    sourceName: 'KPOST_FRD_Module4_KMail_v1.8.docx',
    sourceVersion: 'v1.8',
    sourceDate: '2026-09-16',
    location: SPEC_FOLDER,
    authority: 'AUTHORITATIVE',
    authorityReason: 'CLAUDE.md §4: the six per-module FRDs are the requirement source of truth.',
    supersedes: ['SRC-FULLSUITE-FRD'],
    inRepository: false,
  },
  {
    sourceId: 'SRC-FRD-KDIRECTORY',
    sourceType: 'MODULE_FRD',
    sourceName: 'KPOST_FRD_Module5_KDirectory_v1.0.docx',
    sourceVersion: 'v1.0',
    sourceDate: '2026-09-16',
    location: SPEC_FOLDER,
    authority: 'CONFLICTED',
    authorityReason:
      'The document itself is a per-module FRD and would be AUTHORITATIVE, but BRD §4.2 places ' +
      'KDirectory out of scope while this FRD defines FR-KD-001..006 for it (CLAUDE.md §1 and the ' +
      '2026-09-16 entry). The repository has NOT resolved which governs, so the authority is ' +
      'recorded as disputed rather than silently decided. See CONF-SCOPE-KDIRECTORY.',
    supersedes: ['SRC-FULLSUITE-FRD'],
    inRepository: false,
  },

  // ---- Endpoint/contract sources ---------------------------------------------------------------
  {
    sourceId: 'SRC-WORKBOOK-KPOST-API',
    sourceType: 'REQUIREMENT_WORKBOOK',
    sourceName: 'KPOST API (6).xlsx',
    sourceVersion: '6',
    sourceDate: '2026-09-12',
    location: 'repository root',
    authority: 'AUTHORITATIVE',
    authorityReason:
      'CLAUDE.md §7: "the Excel workbook is the source of truth" for API contracts; the swagger ' +
      'files were deleted because they disagreed with it. Note the live application has overruled ' +
      'individual rows — see CONF-CONTRACT-WORKBOOK-VS-LIVE.',
    inRepository: true,
  },
  {
    sourceId: 'SRC-WORKBOOK-ADMIN',
    sourceType: 'REQUIREMENT_WORKBOOK',
    sourceName: 'Admin_module.xlsx',
    sourceDate: '2026-09-15',
    location: 'repository root',
    authority: 'SECONDARY',
    authorityReason:
      'CLAUDE.md (2026-09-15) records it as "a simplified/inaccurate subset" of the live Admin ' +
      'api-docs; the admin contract is generated from the live service instead, and the admin tab ' +
      'was removed from the converter.',
    supersededBy: ['SRC-OPENAPI-ADMIN', 'SRC-ADMIN-PAYLOAD-PDF'],
    inRepository: true,
  },
  {
    sourceId: 'SRC-ADMIN-PAYLOAD-PDF',
    sourceType: 'REQUIREMENT_WORKBOOK',
    sourceName: 'Admin_module - API Services.pdf',
    sourceDate: '2026-09-19',
    location: 'repository root',
    authority: 'AUTHORITATIVE',
    authorityReason:
      'Owner-supplied authoritative admin payloads; `scripts/apply-admin-pdf-payloads.cjs` rewrites ' +
      'the generated admin OpenAPI request bodies to match it (CLAUDE.md, 2026-09-19).',
    inRepository: true,
  },
  {
    sourceId: 'SRC-CONTRACTS-GENERATED',
    sourceType: 'API_CONTRACT',
    sourceName: 'contracts/*.contract.json + contracts/kpost-types.json',
    location: 'contracts/',
    authority: 'DERIVED',
    authorityReason:
      'Generated by `npm run contract:excel` from the workbook. CLAUDE.md §10: contracts are ' +
      'generated and must never be hand-edited, so they inherit the workbook\u2019s authority.',
    inRepository: true,
  },
  {
    sourceId: 'SRC-OPENAPI-KPOST',
    sourceType: 'OPENAPI',
    sourceName: 'openapi/kpost-api.openapi.json + openapi/kmail-api.openapi.json',
    location: 'openapi/',
    authority: 'DERIVED',
    authorityReason: 'Generated from the KPost workbook by `npm run contract:excel`.',
    inRepository: true,
  },
  {
    sourceId: 'SRC-OPENAPI-ADMIN',
    sourceType: 'OPENAPI',
    sourceName: 'openapi/admin-api.openapi.json',
    location: 'openapi/',
    authority: 'DERIVED',
    authorityReason:
      'Fetched from the live Admin springdoc api-docs by `npm run contract:admin`, then its request ' +
      'bodies rewritten from SRC-ADMIN-PAYLOAD-PDF. Derived from a running service plus an ' +
      'authoritative payload document.',
    inRepository: true,
  },

  // ---- Client and observed behaviour -----------------------------------------------------------
  {
    sourceId: 'SRC-UI-CLIENT',
    sourceType: 'UI_SPECIFICATION',
    sourceName: 'KPOST_REACTJS_2023_V1 (KPost React front end)',
    location: 'D:\\KPOST_PROJECTS\\KPOST_REACTJS_2023_V1',
    authority: 'AUTHORITATIVE',
    authorityReason:
      'CLAUDE.md (2026-09-13): "The frontend becomes the UI source of truth … It is to the UI what ' +
      'the Excel workbook is to the API." Payload shapes and screen selectors are mined from it, ' +
      'and where it disagrees with the workbook the working client wins.',
    inRepository: false,
  },
  {
    sourceId: 'SRC-OBSERVED',
    sourceType: 'OBSERVED_APPLICATION_BEHAVIOUR',
    sourceName: 'Live probing recorded in the CLAUDE.md decision log',
    location: 'CLAUDE.md §8',
    authority: 'OBSERVED',
    authorityReason:
      'Behaviour established by probing the deployed application (response envelopes, error shapes, ' +
      'method corrections). It records what the system DOES, which is evidence, not a requirement.',
    inRepository: true,
  },
];

const BY_ID = new Map(SOURCE_DOCUMENTS.map((doc) => [doc.sourceId, doc]));

/** A source document by id, or `undefined` when the id is not registered. */
export function sourceDocument(sourceId: string): SourceDocument | undefined {
  return BY_ID.get(sourceId);
}

/** Every registered source id. */
export function sourceIds(): string[] {
  return SOURCE_DOCUMENTS.map((doc) => doc.sourceId);
}

/** Sources of one kind. */
export function sourcesOfType(type: SourceType): SourceDocument[] {
  return SOURCE_DOCUMENTS.filter((doc) => doc.sourceType === type);
}
