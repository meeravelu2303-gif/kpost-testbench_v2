import type { BugCategory } from '@config/bugzilla.config';
import { SUITE_IDS, suiteFor, type SuiteId, type SuiteOwnership } from '@config/ownership.config';
import { SEVERITIES, type Severity } from '@engine/validation-result';
import { maskSensitive } from '@utils/masking';
import type { BugCandidate } from '../bug-candidate';
import type { FilingManifest, ManifestDefect } from './manifest';

/**
 * The manifest → `BugCandidate` adapter. **Mapping only.**
 *
 * ## Why this file exists at all
 *
 * The curated path used to render its own Bugzilla description. That duplicate generator is what
 * produced bugs 493–500 with a thin body, `severity: enhancement`, `priority: ---`, an empty
 * whiteboard and no evidence attachment — because a hand-written `createBug` payload silently
 * omitted every field the real builder sets (see
 * `reports/bugs/BUGZILLA-HISTORICAL-FILING-AUDIT.md`).
 *
 * So there is now exactly ONE description generator in this repository,
 * `src/bug-tracker/bug-builder.ts`, and this adapter's only job is to put a reviewed manifest record
 * into the shape that builder already consumes:
 *
 *     manifest record ──► BugCandidate ──► buildBugFields() ──► Bugzilla
 *
 * Nothing here renders an anchor, maps a severity onto Bugzilla's vocabulary, composes a whiteboard
 * or decides a component. Those belong to the builder and to `ownership.config.ts`, and duplicating
 * any of them would recreate the defect this file exists to fix.
 *
 * ## What it refuses to do
 *
 * Invent. A record whose severity band, defect category or owning suite cannot be READ from the
 * manifest and the ownership configuration produces a gate failure naming the field — never a
 * default. `enhancement` reached eight real tickets precisely because an absent value was allowed to
 * become somebody else's default.
 */

/** A value the adapter could not resolve. Reported by `adapterProblems`, never guessed around. */
export interface AdapterProblem {
  canonicalDefectId: string;
  field: string;
  reason: string;
}

export class CuratedAdapterError extends Error {
  override readonly name = 'CuratedAdapterError';
}

/** Run-level facts that live on the manifest's `meta`, not on each record. */
export interface CuratedContext {
  /** When the curated record was produced. Rendered as the ticket's `Run date:`. */
  generatedAt?: string;
  /** The bench build the source run used, when the manifest records one. */
  build?: string;
  product: string;
}

export function contextOf(manifest: FilingManifest): CuratedContext {
  const meta = manifest.meta;
  return {
    product: meta.product,
    generatedAt: typeof meta.generatedAt === 'string' ? meta.generatedAt : undefined,
    build: typeof meta.build === 'string' ? meta.build : undefined,
  };
}

/**
 * The owning suite, found by its Bugzilla product rather than hard-coded.
 *
 * `ownership.config.ts` is the single declaration of which developer owns which product, and a
 * framework test already reconciles it against the live Bugzilla. Looking the suite up through it
 * means the curated path inherits that reconciliation instead of carrying a second opinion.
 */
export function suiteForProduct(product: string): SuiteOwnership | undefined {
  const id = SUITE_IDS.find(
    (candidate: SuiteId) => suiteFor(candidate).bugzilla.product === product,
  );
  return id ? suiteFor(id) : undefined;
}

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

/**
 * The bench severity band a manifest record states.
 *
 * `benchSeverity` is prose — "CRITICAL (bench validator class — NOT a product severity)", or
 * "CRITICAL / HIGH (bench validator classes)" where one canonical defect merged several validator
 * findings. Every band the text names is read, and the HIGHEST wins: a record that is critical under
 * one check and major under another is not a minor one. Undefined when the prose names no band at
 * all, which is a gate failure rather than a default.
 */
export function severityBand(benchSeverity: string | undefined): Severity | undefined {
  if (!benchSeverity) return undefined;
  const found = SEVERITIES.filter((band) =>
    new RegExp(`\\b${band}\\b`).test(benchSeverity.toUpperCase()),
  );
  if (found.length === 0) return undefined;
  return found.reduce((best, band) => (SEVERITY_RANK[band] > SEVERITY_RANK[best] ? band : best));
}

/**
 * The `[cat:Xxx]` axis a manifest record states.
 *
 * Bugzilla has four category values and the manifest writes compound prose
 * ("Functional / Robustness + Information disclosure"), so the LEADING term decides — that is the
 * reviewer's primary classification, and it matches what the engine's own `categoryFor` assigns to
 * the validators behind these defects. An unrecognised leading term returns undefined so the gate
 * names it, because a silently-defaulted category is how a security defect gets filed as functional.
 */
const CATEGORY_BY_TERM: Readonly<Record<string, BugCategory>> = {
  functional: 'Functional',
  contract: 'Functional',
  robustness: 'Functional',
  security: 'Security',
  authentication: 'Security',
  authorization: 'Security',
  performance: 'Performance',
  compatibility: 'Compatibility',
};

export function categoryAxis(category: string | undefined): BugCategory | undefined {
  if (!category) return undefined;
  const leading = category.split(/[/+,]/)[0]?.trim().toLowerCase() ?? '';
  return CATEGORY_BY_TERM[leading];
}

/** The environment descriptor and the host, out of the one string the manifest records. */
export function splitEnvironment(environment: string): { environment: string; baseURL: string } {
  const match = /^(\S+)\s*\((.+)\)\s*$/.exec(environment.trim());
  if (!match?.[1] || !match[2]) return { environment, baseURL: environment };
  return { environment: match[2], baseURL: match[1] };
}

/**
 * Everything that stops this record becoming a candidate.
 *
 * Separate from `manifestToCandidate` so the filer's pre-flight gate can report every problem at
 * once instead of throwing on the first. All-or-nothing refusal needs the whole list.
 */
export function adapterProblems(defect: ManifestDefect, context: CuratedContext): AdapterProblem[] {
  const problems: AdapterProblem[] = [];
  const at = (field: string, reason: string): void => {
    problems.push({ canonicalDefectId: defect.canonicalDefectId, field, reason });
  };

  const suite = suiteForProduct(defect.product);
  if (!suite) {
    at('product', `"${defect.product}" matches no suite in ownership.config.ts`);
  } else if (suite.owner.email !== defect.assignee) {
    // Drift on either side is a real problem, not a preference: the manifest cites
    // ownership.config.ts as its assignment source, so the two disagreeing means one is stale.
    at(
      'assignee',
      `manifest says ${defect.assignee}, ownership.config.ts says ${suite.owner.email}`,
    );
  }
  if (defect.product !== context.product) {
    at('product', `record is "${defect.product}" but the manifest is for "${context.product}"`);
  }
  if (!defect.enrichment) {
    at(
      'enrichment',
      'no enrichment block — the classification, category and reproduction command a ticket needs ' +
        'are not present, so the record is not fileable',
    );
    return problems;
  }
  if (!severityBand(defect.benchSeverity)) {
    at(
      'benchSeverity',
      `"${defect.benchSeverity ?? '(absent)'}" names no severity band; Bugzilla would default it`,
    );
  }
  if (!categoryAxis(defect.enrichment.category)) {
    at('enrichment.category', `"${defect.enrichment.category}" is not a known defect category`);
  }
  if (!defect.benchTags[0]?.trim()) at('benchTags', 'no dedupe tag');
  return problems;
}

/** The prose above Expected/Actual — the reviewed narrative, and the scope boundary it must keep. */
function narrativeOf(defect: ManifestDefect): string {
  const e = defect.enrichment;
  const lines: string[] = [];
  if (e) lines.push(e.whatThisMeans, '', e.whyItMatters);
  if (defect.confirmedScope) {
    /*
     * The single most important line for the mixed findings. The AWS crash is confirmed for
     * `extension: null` and measured as WORKING for `fileName: null`; the kpostIdExist crash is
     * confirmed for `mobileNumber: null` while `kpostID: null` returns a HANDLED 500. A ticket that
     * blurred either would send a developer after behaviour the bench proved is fine.
     */
    lines.push(
      '',
      `Confirmed scope: ${defect.confirmedScope}`,
      'Nothing outside that scope is claimed here. Where the evidence showed the product handling ' +
        'a case correctly, it is named above as not confirmed rather than left ambiguous.',
    );
  }
  if (e) lines.push('', `What the evidence supports: ${e.developerGuidance}`);
  lines.push(
    '',
    `Canonical defect ${defect.canonicalDefectId}. Bench severity classification: ` +
      `${defect.benchSeverity ?? '(not stated)'}. The Bugzilla severity field carries the bench's ` +
      'band for triage ordering; the product severity is the team’s call, not the bench’s.',
  );
  return lines.join('\n');
}

/** Reproduction, control, confirmation and evidence trail — rendered under the builder's `Repro:`. */
function reproOf(defect: ManifestDefect): string {
  const e = defect.enrichment;
  const lines = defect.reproduction.map((step, i) => `  ${String(i + 1)}. ${step}`);
  // The prose control only when there is no control COMMAND — otherwise a record whose `control`
  // reads "n/a" sits directly above a runnable control, which reads as a contradiction.
  if (defect.control && !e?.controlCurl) lines.push('', `Known-good control: ${defect.control}`);
  if (e?.controlCurl) {
    lines.push('', 'Known-good control — run this first; it should succeed:', e.controlCurl);
    if (e.controlResult) lines.push(`  → ${e.controlResult}`);
  }
  lines.push(
    '',
    `Independent confirmation: ${defect.independentConfirmation}`,
    'That is evidence from a source other than the check that raised the finding — the validator’s ' +
      'own assertion is not treated as confirmation of itself.',
  );
  if (e)
    lines.push('', `Affected scope: ${e.affectedScope}`, `Reproduction history: ${e.occurrences}`);
  if (e?.contractNote) lines.push('', `Contract note: ${e.contractNote}`);
  if (defect.relatedTo) lines.push('', `Related: ${defect.relatedTo}`);
  if (defect.bugzillaAdjacency)
    lines.push('', `Existing Bugzilla context: ${defect.bugzillaAdjacency}`);
  lines.push(
    '',
    'Evidence references (correlation ids — searchable in the application logs):',
    ...defect.evidenceRefs.map((ref) => `  ${ref}`),
    `Source run: ${defect.sourceRun}`,
  );
  return lines.join('\n');
}

/**
 * One reviewed manifest record as a `BugCandidate`.
 *
 * Throws when `adapterProblems` finds anything, so a half-mapped candidate can never reach the
 * builder. The filer calls the gate first, which is why the throw is a safety net rather than the
 * normal error path.
 */
export function manifestToCandidate(defect: ManifestDefect, context: CuratedContext): BugCandidate {
  const problems = adapterProblems(defect, context);
  if (problems.length > 0) {
    throw new CuratedAdapterError(
      `${defect.canonicalDefectId} cannot be mapped: ` +
        problems.map((p) => `${p.field} — ${p.reason}`).join('; '),
    );
  }
  // Every one of these is proven present by `adapterProblems` above.
  const suite = suiteForProduct(defect.product) as SuiteOwnership;
  const enrichment = defect.enrichment as NonNullable<ManifestDefect['enrichment']>;
  const severity = severityBand(defect.benchSeverity) as Severity;
  const category = categoryAxis(enrichment.category) as BugCategory;
  const { environment, baseURL } = splitEnvironment(defect.environment);
  const endpointLabel = `${defect.method.toUpperCase()} ${defect.endpoint}`;

  return {
    // The dedupe tag the bench already filed under, so a rerun finds the ticket instead of adding one.
    id: defect.benchTags[0] as string,
    source: 'api',
    suiteId: suite.id,
    // Endpoint first, as the broad filer's titles do, so the queue reads by resource.
    title: `${endpointLabel}: ${defect.summary}`,
    narrative: narrativeOf(defect),
    severity,
    category,
    classification: enrichment.classification,
    // Product, version and owner come from the ownership configuration — the same source the broad
    // filer uses — so the two paths cannot drift. Only the component is per-defect.
    product: suite.bugzilla.product,
    component: defect.component,
    version: suite.bugzilla.version,
    assignee: suite.owner.email,
    ownerName: suite.owner.name,
    endpoint: endpointLabel,
    expected: defect.expected,
    actual: defect.actual,
    repro: reproOf(defect),
    curl: enrichment.curl,
    // The evidence refs ARE correlation ids; the first anchors the log search, the rest are listed
    // in the repro block so none is lost.
    correlationId: defect.evidenceRefs[0],
    // One curated record is one reviewed defect. The observation count is prose on the enrichment
    // block and is rendered in the repro trail rather than invented as a number here.
    occurrences: 1,
    environment,
    baseURL,
    build: context.build ?? 'unrecorded',
    testRunId: defect.sourceRun,
    observedAt: context.generatedAt ?? '(not recorded)',
    // The whole reviewed record as the attachment, so the developer has the unabridged evidence the
    // description had to clamp. Masked again here even though the manifest is gate-scanned: defence
    // in depth costs nothing and a leak in an attachment is as permanent as one in a comment.
    evidence: maskSensitive({ ...defect }),
  };
}
