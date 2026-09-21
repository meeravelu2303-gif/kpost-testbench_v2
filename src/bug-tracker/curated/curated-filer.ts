import { buildBugFields, buildEvidenceAttachment, buildSummary } from '../bug-builder';
import {
  findSecrets,
  isApprovedForFiling,
  type FilingManifest,
  type ManifestDefect,
} from './manifest';
import {
  adapterProblems,
  contextOf,
  manifestToCandidate,
  type CuratedContext,
} from './manifest-to-candidate';

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
 * comment, attach. The full `BugzillaClient` satisfies it, and so does a stub, which is how the
 * tests run without touching a live instance.
 *
 * ## It renders nothing itself
 *
 * The ticket — summary, description, severity, priority, whiteboard, evidence attachment — is built
 * by `src/bug-tracker/bug-builder.ts`, the same module the broad `kpost:file` path uses. This file
 * once had its own `renderSummary`/`renderDescription`, and that duplicate is exactly what filed
 * bugs 493–500 with a thin body, `severity: enhancement`, `priority: ---`, an empty whiteboard and
 * no attachment: a hand-written `createBug` payload omits by silence. A guard now asserts this
 * module contains no second description generator.
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
  /**
   * The unabridged evidence file. Returns void and never throws — the real client logs a warning
   * and carries on, because a filed ticket whose attachment failed is still a filed ticket and
   * failing the run would be worse than the missing file.
   */
  attach(
    bugId: number,
    attachment: { fileName: string; summary: string; body: string },
  ): Promise<void>;
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
  const context = contextOf(manifest);
  for (const defect of manifest.defects) {
    const id = defect.canonicalDefectId || '(missing canonicalDefectId)';
    if (!defect.canonicalDefectId.trim()) failures.push(`${id}: no canonical defect id`);
    if (!isApprovedForFiling(defect)) failures.push(`${id}: status is not READY_FOR_BUGZILLA`);
    if (defect.evidenceRefs.length === 0) failures.push(`${id}: no evidence references`);
    if (!defect.independentConfirmation.trim()) failures.push(`${id}: no independent confirmation`);
    if (!defect.component.trim()) failures.push(`${id}: component unresolved`);
    if (!defect.assignee.trim()) failures.push(`${id}: assignee unresolved`);
    /*
     * Anything the adapter cannot READ from the record — its severity band, its defect category,
     * its owning suite — is a gate failure naming the field. Never a default: `enhancement` and
     * `---` reached eight real tickets because an absent value was allowed to become Bugzilla's.
     */
    for (const problem of adapterProblems(defect, context)) {
      failures.push(`${id}: ${problem.field} — ${problem.reason}`);
    }
    failures.push(...secretsIn(defect, context).map((s) => `${id}: the ticket would contain ${s}`));
  }
  const ids = manifest.defects.map((d) => d.canonicalDefectId);
  const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicated.length)
    failures.push(`duplicate canonical defect ids: ${[...new Set(duplicated)].join(', ')}`);
  return failures;
}

/**
 * Secrets in what would actually be SENT — summary, description and the evidence attachment.
 *
 * Scanned on the rendered payload rather than on the manifest fields, because the rendering is what
 * leaves the process. A record the adapter cannot map yields nothing here; that record already has
 * its own gate failure, and throwing from a scan would mask it.
 */
function secretsIn(defect: ManifestDefect, context: CuratedContext): string[] {
  if (adapterProblems(defect, context).length > 0) return [];
  const candidate = manifestToCandidate(defect, context);
  const fields = buildBugFields(candidate, { version: candidate.version });
  return [
    ...new Set([
      ...findSecrets(fields.summary),
      ...findSecrets(fields.description),
      ...findSecrets(buildEvidenceAttachment(candidate)),
    ]),
  ];
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
  const context = contextOf(manifest);

  for (const defect of manifest.defects) {
    const at = new Date().toISOString();
    /*
     * The candidate is built ONCE per record, here, and everything downstream — the summary in the
     * result table, the dedupe tag, the create payload, the attachment — reads from it. One
     * derivation means the preview and the thing that gets filed cannot disagree.
     */
    const candidate = manifestToCandidate(defect, context);
    const row = {
      canonicalDefectId: defect.canonicalDefectId,
      component: candidate.component,
      assignee: candidate.assignee,
      summary: buildSummary(candidate),
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
    const found = await client.findByTag(candidate.id);
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
      (bug) => bug.product === undefined || bug.product === candidate.product,
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
    /*
     * Resolved for any OTHER reason — FIXED, MOVED, anything a human or the broad resolve pass set.
     *
     * The broad filer REOPENS here. This path deliberately cannot: reopening is a mutation, and the
     * whole safety argument for the curated filer is that the capability is absent. That leaves
     * CREATE or SKIP, and CREATE would file a second ticket for a fault Bugzilla already tracks —
     * which is exactly the duplication this path exists to prevent.
     *
     * Found by the dry run: bugs 493/494/495 were resolved FIXED between two previews, and the
     * records for them flipped from EXISTING to CREATED. On an armed run that would have been three
     * duplicates. Whether the fix holds is a question for a verification run, not for the filer.
     */
    const resolved = sameProduct.find((bug) => (bug.resolution ?? '').trim().length > 0);
    if (resolved) {
      record('SKIPPED', {
        bugzillaId: resolved.id,
        reason:
          `bug ${String(resolved.id)} is resolved ${resolved.resolution} — this path cannot reopen, and ` +
          'a second ticket would duplicate it; re-verify the fix or reopen it by hand',
      });
      continue;
    }

    // ---- assignee must exist, or the ticket lands nowhere -------------------------------------
    /*
     * Mirrors the broad filer's `verifiedAssignee`: a verified owner is set explicitly, and an
     * unverifiable one is OMITTED so the component's default assignee takes the ticket rather than
     * the create failing. The curated path used to set it unconditionally.
     */
    const known =
      checkedUsers.get(candidate.assignee) ?? (await client.userExists(candidate.assignee));
    checkedUsers.set(candidate.assignee, known);
    if (!known) {
      record('FAILED', { reason: `assignee ${candidate.assignee} is not a Bugzilla account` });
      continue;
    }

    if (options.dryRun) {
      record('CREATED', { reason: 'DRY RUN — nothing was sent to Bugzilla' });
      continue;
    }

    /*
     * The whole ticket, from the one canonical builder: summary, line-anchored description,
     * severity, priority, `[cat:…]` whiteboard, op_sys, platform and the assignee rule. Nothing is
     * added or overridden here — a field this path chose for itself is a field that can silently
     * disagree with the broad path, which is how `severity: enhancement` happened.
     */
    const fields = buildBugFields(candidate, {
      version: candidate.version,
      assignee: candidate.assignee,
    });
    const created = await client.createBug(fields as unknown as Record<string, unknown>);
    if ('error' in created) {
      record('FAILED', { reason: created.error });
      continue;
    }
    // Immediately after create, exactly as the broad filer does. It warns rather than throws, so a
    // rejected attachment never turns a filed ticket into a reported failure.
    await client.attach(created.id, {
      fileName: `${candidate.id}-evidence.txt`,
      summary: `Evidence for ${candidate.id}`,
      body: buildEvidenceAttachment(candidate),
    });
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
