import {
  findSecrets,
  isApprovedForFiling,
  type FilingManifest,
  type ManifestDefect,
} from './manifest';

/**
 * The curated filer — files ONLY what the manifest approves, and cannot do anything else.
 *
 * ## What makes it safe is what it does not contain
 *
 * This module has no code path that resolves, closes, reopens or adopts a bug. That is not a flag
 * that could be flipped by an environment variable or a careless edit: the capability is absent, and
 * a guard asserts the source never names those operations. `BUGZILLA_AUTO_RESOLVE` is irrelevant
 * here because there is nothing for it to enable.
 *
 * The client it takes is the narrowest interface that does the job — search, user check, create,
 * comment. The full `BugzillaClient` satisfies it, and so does a stub, which is how the tests run
 * without touching a live instance.
 *
 * ## Eligibility and deduplication are separate concerns, deliberately
 *
 *     eligibility    comes ONLY from the manifest
 *     deduplication  decides whether an approved defect is ALREADY in Bugzilla
 *
 * Collapsing them is how a broad sweep ends up filing whatever happens to be missing. Here, dedup can
 * only ever turn a CREATE into an EXISTING — it can never promote something the manifest did not
 * approve.
 */

/** The slice of the Bugzilla client this filer uses. Narrow, so a test can supply a stub. */
export interface CuratedBugzillaClient {
  findByTag(tag: string): Promise<{ bugs: BugRef[] } | { error: string }>;
  userExists(email: string): Promise<boolean>;
  createBug(fields: Record<string, unknown>): Promise<{ id: number } | { error: string }>;
  addComment(bugId: number, body: string): Promise<{ ok: true } | { error: string }>;
}

/**
 * The subset of a Bugzilla bug this filer reads.
 *
 * Mirrors `BugSummary` from the real client EXACTLY, including the optionality: Bugzilla omits
 * `resolution` on an open bug and `product` when the query did not ask for it. An earlier version
 * of this type assumed both were always present and a `status` string existed; the live dry run
 * threw on it immediately. Optional-by-default is the honest shape for data from another system.
 */
export interface BugRef {
  id: number;
  summary: string;
  is_open: boolean;
  resolution?: string;
  product?: string;
}

export const FILING_OPERATIONS = ['CREATED', 'EXISTING', 'SKIPPED', 'FAILED'] as const;
export type FilingOperation = (typeof FILING_OPERATIONS)[number];

export interface CuratedFilingEntry {
  canonicalDefectId: string;
  operation: FilingOperation;
  bugzillaId?: number;
  component: string;
  assignee: string;
  summary: string;
  /** Why it was skipped or how it failed. Present for SKIPPED and FAILED. */
  reason?: string;
  timestamp: string;
}

export interface CuratedFilingResult {
  dryRun: boolean;
  loaded: number;
  approved: number;
  entries: CuratedFilingEntry[];
  counts: Record<FilingOperation, number>;
  /** True only when every gate passed and nothing was refused before the run. */
  gatesPassed: boolean;
  gateFailures: string[];
}

export interface CuratedFilerOptions {
  dryRun: boolean;
  /** Written into each summary so a rerun deduplicates instead of creating a second ticket. */
  tagPrefix?: string;
}

/**
 * A resolution a HUMAN reached. The filer never overrides one.
 *
 * If somebody closed a ticket as INVALID, refiling the same fault is the bench overruling a person
 * who looked at it. That decision is theirs to revisit.
 */
const HUMAN_JUDGED = new Set(['INVALID', 'WONTFIX', 'WORKSFORME', 'DUPLICATE']);

/** Whether a Bugzilla bug is still open, as Bugzilla itself reports it. */
const isOpen = (bug: BugRef): boolean => bug.is_open === true;

/**
 * Pre-flight gates. Every one must pass before ANY record is submitted.
 *
 * Deliberately all-or-nothing: a manifest with one bad record does not file the other seven. A
 * half-filed release is harder to reason about than a refused one, and the whole point of this path
 * is that what reaches Bugzilla was reviewed as a set.
 */
export function checkFilingGates(manifest: FilingManifest): string[] {
  const failures: string[] = [];
  for (const defect of manifest.defects) {
    const id = defect.canonicalDefectId || '(missing canonicalDefectId)';
    if (!defect.canonicalDefectId.trim()) failures.push(`${id}: no canonical defect id`);
    if (!isApprovedForFiling(defect)) failures.push(`${id}: status is not READY_FOR_BUGZILLA`);
    if (defect.evidenceRefs.length === 0) failures.push(`${id}: no evidence references`);
    if (!defect.independentConfirmation.trim()) failures.push(`${id}: no independent confirmation`);
    if (!defect.component.trim()) failures.push(`${id}: component unresolved`);
    if (!defect.assignee.trim()) failures.push(`${id}: assignee unresolved`);
    const secrets = findSecrets(renderDescription(defect));
    if (secrets.length)
      failures.push(`${id}: the generated description contains ${secrets.join(', ')}`);
  }
  const ids = manifest.defects.map((d) => d.canonicalDefectId);
  const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicated.length)
    failures.push(`duplicate canonical defect ids: ${[...new Set(duplicated)].join(', ')}`);
  return failures;
}

/** The ticket summary, carrying the dedupe tag a rerun matches on. */
export function renderSummary(defect: ManifestDefect): string {
  return `[${defect.benchTags[0] ?? defect.canonicalDefectId}] ${defect.summary}`;
}

/**
 * The ticket body.
 *
 * Built only from manifest fields, so a defect's CONFIRMED SCOPE travels with it. That matters for
 * the mixed findings: the AWS crash is confirmed for `extension: null` and explicitly not for
 * `fileName: null`, and a description that blurred the two would send a developer after behaviour
 * the bench measured as working.
 *
 * Severity is stated as the BENCH's validator class and never as a product severity, because nothing
 * in this repository establishes one.
 */
export function renderDescription(defect: ManifestDefect): string {
  const lines: string[] = [
    `Canonical defect: ${defect.canonicalDefectId}`,
    `Module: ${defect.module} · Component: ${defect.component}`,
    `Endpoint: ${defect.method} ${defect.endpoint}`,
    `Environment: ${defect.environment}`,
    `Source run: ${defect.sourceRun}`,
    '',
  ];
  if (defect.confirmedScope) {
    lines.push('CONFIRMED SCOPE', defect.confirmedScope, '');
  }
  lines.push('STEPS TO REPRODUCE');
  defect.reproduction.forEach((step, i) => lines.push(`  ${String(i + 1)}. ${step}`));
  lines.push('');
  if (defect.control) lines.push('KNOWN-GOOD CONTROL', `  ${defect.control}`, '');
  lines.push('EXPECTED', `  ${defect.expected}`, '');
  lines.push('ACTUAL', `  ${defect.actual}`, '');
  lines.push('INDEPENDENT CONFIRMATION', `  ${defect.independentConfirmation}`, '');
  lines.push('EVIDENCE', ...defect.evidenceRefs.map((ref) => `  ${ref}`), '');
  if (defect.relatedTo) lines.push('RELATED', `  ${defect.relatedTo}`, '');
  if (defect.bugzillaAdjacency) lines.push('NOTE', `  ${defect.bugzillaAdjacency}`, '');
  if (defect.benchSeverity) {
    lines.push(
      'SEVERITY',
      `  ${defect.benchSeverity}`,
      `  Product severity: ${defect.productSeverity ?? 'to be determined by the product/backend team'}`,
      '',
    );
  }
  lines.push(`Ownership: ${defect.ownerName} <${defect.assignee}> — ${defect.assignmentSource}`);
  return lines.join('\n');
}

const counts = (): Record<FilingOperation, number> => ({
  CREATED: 0,
  EXISTING: 0,
  SKIPPED: 0,
  FAILED: 0,
});

/**
 * Files the approved defects.
 *
 * Each record is independent: one failure is recorded and the rest continue, so a partial Bugzilla
 * outage produces an honest result rather than an all-or-nothing lie. The run is safely repeatable —
 * a defect already in Bugzilla under its tag comes back as EXISTING, never as a second ticket.
 */
export async function fileCuratedDefects(
  manifest: FilingManifest,
  client: CuratedBugzillaClient,
  options: CuratedFilerOptions,
): Promise<CuratedFilingResult> {
  const gateFailures = checkFilingGates(manifest);
  const base = {
    dryRun: options.dryRun,
    loaded: manifest.defects.length,
    approved: manifest.defects.filter(isApprovedForFiling).length,
  };
  if (gateFailures.length > 0) {
    return { ...base, entries: [], counts: counts(), gatesPassed: false, gateFailures };
  }

  const entries: CuratedFilingEntry[] = [];
  const tally = counts();
  const checkedUsers = new Map<string, boolean>();

  for (const defect of manifest.defects) {
    const at = new Date().toISOString();
    const row = {
      canonicalDefectId: defect.canonicalDefectId,
      component: defect.component,
      assignee: defect.assignee,
      summary: renderSummary(defect),
      timestamp: at,
    };
    const record = (operation: FilingOperation, extra: Partial<CuratedFilingEntry> = {}): void => {
      entries.push({ ...row, operation, ...extra });
      tally[operation] += 1;
    };

    // ---- eligibility. The manifest is the only source, and it was already gated above. --------
    if (!isApprovedForFiling(defect)) {
      record('SKIPPED', { reason: 'not READY_FOR_BUGZILLA' });
      continue;
    }

    // ---- deduplication. Can only turn a CREATE into an EXISTING, never the reverse. -----------
    const tag = defect.benchTags[0] ?? defect.canonicalDefectId;
    const found = await client.findByTag(tag);
    if ('error' in found) {
      record('FAILED', {
        reason: `dedup search failed, so filing would risk a duplicate: ${found.error}`,
      });
      continue;
    }
    /*
     * Product scoping. A bug whose product Bugzilla did not return is INCLUDED rather than dropped:
     * the same tag can legitimately exist under KMail, but treating an unknown product as "not mine"
     * would file a duplicate, which is the worse of the two mistakes.
     */
    const sameProduct = found.bugs.filter(
      (bug) => bug.product === undefined || bug.product === defect.product,
    );
    const judged = sameProduct.find((bug) =>
      HUMAN_JUDGED.has((bug.resolution ?? '').toUpperCase()),
    );
    if (judged) {
      record('SKIPPED', {
        bugzillaId: judged.id,
        reason:
          `bug ${String(judged.id)} was resolved ${judged.resolution} by a person — the filer never ` +
          'overrides a human judgement',
      });
      continue;
    }
    const open = sameProduct.find(isOpen);
    if (open) {
      record('EXISTING', { bugzillaId: open.id, reason: 'already represented by an open bug' });
      continue;
    }

    // ---- assignee must exist, or the ticket lands nowhere -------------------------------------
    const known = checkedUsers.get(defect.assignee) ?? (await client.userExists(defect.assignee));
    checkedUsers.set(defect.assignee, known);
    if (!known) {
      record('FAILED', { reason: `assignee ${defect.assignee} is not a Bugzilla account` });
      continue;
    }

    if (options.dryRun) {
      record('CREATED', { reason: 'DRY RUN — nothing was sent to Bugzilla' });
      continue;
    }

    const created = await client.createBug({
      product: defect.product,
      component: defect.component,
      summary: renderSummary(defect),
      description: renderDescription(defect),
      assigned_to: defect.assignee,
      version: 'unspecified',
      op_sys: 'All',
      platform: 'All',
    });
    if ('error' in created) {
      record('FAILED', { reason: created.error });
      continue;
    }
    record('CREATED', { bugzillaId: created.id });
  }

  return { ...base, entries, counts: tally, gatesPassed: true, gateFailures: [] };
}

/** One line per record, for the console and the result report. Carries no secret. */
export function summariseCuratedFiling(result: CuratedFilingResult): string[] {
  return result.entries.map(
    (entry) =>
      `${entry.operation.padEnd(9)} ${entry.canonicalDefectId.padEnd(30)} ` +
      `${entry.bugzillaId ? `bug ${String(entry.bugzillaId)}` : '—'}` +
      `${entry.reason ? ` · ${entry.reason}` : ''}`,
  );
}
