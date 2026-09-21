import { z } from 'zod';

/**
 * The curated filing manifest — the ONLY thing that may become a Bugzilla ticket on this path.
 *
 * ## Why a file, and why this shape
 *
 * The broad filer derives its population from the RUN: every candidate that clears the validity gate
 * becomes a ticket. That is right for a sweep and wrong for a curated release — on the current corpus
 * it would file 109 tickets, of which 8 are confirmed defects and the rest are evidence-incomplete.
 *
 * So this path inverts the source. The population is an explicit allowlist a person reviewed, and a
 * finding that is not in it cannot be filed by any code path here. There is no "file everything that
 * looks ready" mode, because that is the failure being designed out.
 *
 * ## The architectural boundary it preserves
 *
 *     canonical-defect  ──writes──►  MANIFEST  ──reads──►  bug-tracker
 *
 * Phase 13 forbids `src/bug-tracker` from importing the canonical-defect module, so that
 * deduplication, confidence and filing stay separable. This file is the DTO that keeps them apart:
 * it is plain data with a schema, it imports nothing from the analysis layers, and the filer depends
 * on it rather than on how a canonical defect is computed.
 */

/**
 * The only status that may be filed.
 *
 * Every other status a record could carry — `POTENTIAL_DEFECT`, `CONTRACT_UNPROVEN`,
 * `INFRASTRUCTURE_ORIGIN`, `BENCH_ARTEFACT`, `NOT_A_DEFECT`, anything not yet invented — is refused
 * by construction, because the schema accepts this literal and nothing else.
 */
export const FILEABLE_STATUS = 'READY_FOR_BUGZILLA';

/**
 * One approved defect.
 *
 * The required fields are the ones a ticket cannot be honest without: what was expected, what
 * happened, how to reproduce it, and how it was independently confirmed. A record missing any of
 * them fails the schema and the whole manifest is refused — a partial load would silently file a
 * subset, which is worse than filing nothing.
 */
export const manifestDefectSchema = z
  .object({
    /** Required, and never generated here — the filer refuses a record without one. */
    canonicalDefectId: z.string().min(3),
    summary: z.string().min(10),
    endpoint: z.string().min(1),
    method: z.string().min(1),
    module: z.string().min(1),
    product: z.string().min(1),
    component: z.string().min(1),
    assignee: z.email(),
    ownerName: z.string().min(1),
    assignmentSource: z.string().min(1),
    environment: z.string().min(1),
    expected: z.string().min(1),
    actual: z.string().min(1),
    reproduction: z.array(z.string().min(1)).min(1),
    /** Which mutation/condition is CONFIRMED, when a defect has a narrower scope than its endpoint. */
    confirmedScope: z.string().optional(),
    control: z.string().optional(),
    independentConfirmation: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    /** The bench `[KP-XXXXXX]` tags this defect was observed under. The first is the dedupe tag. */
    benchTags: z.array(z.string().min(3)).min(1),
    /** The bench's validator class. Recorded as such — never presented as a product severity. */
    benchSeverity: z.string().optional(),
    productSeverity: z.string().optional(),
    relatedTo: z.string().optional(),
    bugzillaAdjacency: z.string().optional(),
    sourceRun: z.string().min(1),
    /*
     * Audit metadata carried WITH the record rather than alongside it, so a reviewer reading one
     * defect sees the checklist it passed, what deduplication found and that its content was
     * scanned. Shapes are loose on purpose: these are evidence for a human, and the filer makes no
     * decision from them — every gate it enforces is recomputed in `checkFilingGates`.
     */
    gates: z.record(z.string(), z.union([z.boolean(), z.string()])).optional(),
    deduplication: z.record(z.string(), z.string()).optional(),
    secretsScan: z.string().optional(),
    /** Set once the defect has been filed. Read from the filing result, never guessed. */
    bugzillaId: z.number().int().positive().optional(),
    /**
     * The developer-facing evidence: what the defect means, why it matters, the reproduction
     * command and the scope the evidence actually covers.
     *
     * Optional in the SCHEMA because the enrich path reads records written before it existed, but
     * REQUIRED to file: `adapterProblems` refuses a record without one, because its
     * `classification` and `category` are what a ticket's Classification line and `[cat:…]` axis
     * are built from, and a record that cannot state them is not reviewed enough to reach a
     * developer.
     */
    enrichment: z
      .object({
        classification: z.string().min(1),
        category: z.string().min(1),
        whatThisMeans: z.string().min(20),
        whyItMatters: z.string().min(20),
        developerGuidance: z.string().min(20),
        occurrences: z.string().min(5),
        curl: z.string().min(10),
        controlCurl: z.string().optional(),
        controlResult: z.string().optional(),
        affectedScope: z.string().min(5),
        contractNote: z.string().optional(),
      })
      .optional(),
    filingStatus: z.literal(FILEABLE_STATUS),
  })
  .strict();

export type ManifestDefect = z.infer<typeof manifestDefectSchema>;

export const filingManifestSchema = z.object({
  /*
   * Loose on purpose — the manifest also carries reviewer notes (blockers, warnings, counts) that
   * no code reads. The fields named here are the ones the filing path DOES read, typed so the
   * adapter never has to widen an `unknown`.
   */
  meta: z.looseObject({
    product: z.string().min(1),
    /** When the curated record was produced. Becomes the ticket's `Run date:`. */
    generatedAt: z.string().optional(),
    sourceRun: z.string().optional(),
    /** The bench build behind the source run, when it was recorded. */
    build: z.string().optional(),
  }),
  defects: z.array(manifestDefectSchema).min(1),
});

export type FilingManifest = z.infer<typeof filingManifestSchema>;

export class ManifestError extends Error {
  override readonly name = 'ManifestError';
}

/**
 * Parses and validates a manifest.
 *
 * Throws rather than returning a partial result. A manifest that half-parses is the shape most
 * likely to file the wrong thing, so the filer never sees one.
 */
export function parseFilingManifest(raw: unknown, source: string): FilingManifest {
  const parsed = filingManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ManifestError(`${source} is not a valid filing manifest — ${issues}`);
  }
  return parsed.data;
}

/**
 * Whether a record may be filed.
 *
 * Deliberately a separate, explicit predicate rather than relying on the schema alone: the schema
 * says the file is well-formed, this says the record is approved. A reviewer can read this one line
 * and know exactly what reaches Bugzilla.
 */
export function isApprovedForFiling(defect: ManifestDefect): boolean {
  return defect.filingStatus === FILEABLE_STATUS && defect.canonicalDefectId.trim().length > 0;
}

/** Patterns that must never reach a ticket. Checked on the rendered body, not on inputs. */
const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i, 'a bearer token'],
  [/\beyJ[A-Za-z0-9._-]{20,}/, 'a JWT'],
  [/\b(?:api[_-]?key|apikey)\s*[:=]\s*\S+/i, 'an API key'],
  [/\bcookie\s*:\s*\S+/i, 'a cookie'],
  [/\b(?:password|passwd|pwd)\s*[:=]\s*\S+/i, 'a password'],
  [/\b(?:otp|verification[_-]?code)\s*[:=]\s*\d{4,}/i, 'an OTP'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
];

/**
 * Secrets found in text destined for Bugzilla.
 *
 * Run on the RENDERED description rather than on the manifest fields, because that is what actually
 * leaves the process. A ticket is permanent and visible to everyone with Bugzilla access, so this
 * refuses the record rather than redacting it — a redaction that silently fires is a bug nobody sees.
 */
export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}
