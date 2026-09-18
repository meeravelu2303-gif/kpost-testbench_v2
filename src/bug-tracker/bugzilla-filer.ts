import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JUDGED_NOT_A_DEFECT, type BugzillaConfig } from '@config/bugzilla.config';
import { SUITES, suiteFor } from '@config/ownership.config';
import type { Logger } from '@utils/logger';
import {
  buildAdoptionComment,
  buildBugFields,
  buildDescription,
  buildEvidenceAttachment,
  buildReopenComment,
  buildReproducedComment,
  buildSummary,
  sameFault,
  summaryPhrase,
} from './bug-builder';
import type { BugCandidate } from './bug-candidate';
import type { BugSummary, BugzillaClient, ProductMetadata } from './bugzilla-client';
import { normalizeEndpoint, normalizeValidator } from './verify-resolve';

/**
 * Decides what to do with each candidate and does it.
 *
 * The decision tree — the reason re-running this never multiplies tickets:
 *
 *   tagged bug is OPEN                         → comment (it reproduced)
 *   tagged bug is INVALID/WONTFIX/WORKSFORME/DUPLICATE → skip forever (a human judged it)
 *   tagged bug is resolved otherwise (FIXED)   → reopen the original
 *   an untagged OPEN ticket describes the same fault → comment + adopt it with our tag
 *   nothing found                              → file a new bug
 *   the SEARCH failed                          → file nothing (a transient error must never
 *                                                mint a duplicate)
 *
 * Every new ticket is assigned to the module's developer (ownership.config.ts) once the account
 * is verified; an unverifiable account means the field is omitted and Bugzilla's component
 * default assignee takes it, rather than the create being refused.
 */

/**
 * Largest proof file uploaded to a ticket. Screenshots are tiny; a UI video is usually 1–10 MB. The
 * cap keeps one giant recording from stalling the filer or exceeding Bugzilla's limit — over it, the
 * file is skipped with a warning (the screenshot still attaches). Bugzilla's own `maxattachmentsize`
 * may be lower; a rejected upload only warns and never fails the run.
 */
const MAX_PROOF_MB = 25;
const MAX_PROOF_BYTES = MAX_PROOF_MB * 1024 * 1024;

export type FilingDecision =
  | 'created'
  | 'commented'
  | 'reopened'
  | 'adopted'
  | 'judged-skip'
  | 'would-file'
  | 'capped'
  | 'failed';

export interface FilingEntry {
  id: string;
  decision: FilingDecision;
  bugId?: number;
  summary: string;
  product: string;
  component: string;
  /** Who the ticket went to. */
  assignee: string;
  severity: string;
  reason?: string;
  /** Full ticket text — present on a dry run so the output can be reviewed before filing. */
  description?: string;
}

export interface FilingOutcome {
  dryRun: boolean;
  entries: FilingEntry[];
  counts: Record<FilingDecision, number>;
}

const emptyCounts = (): Record<FilingDecision, number> => ({
  created: 0,
  commented: 0,
  reopened: 0,
  adopted: 0,
  'judged-skip': 0,
  'would-file': 0,
  capped: 0,
  failed: 0,
});

interface FilingTarget {
  component: string;
  version: string;
  assignee?: string;
}

export class BugzillaFiler {
  /** Verified Bugzilla accounts, so one lookup per developer per run. */
  private readonly knownAssignees = new Map<string, boolean>();
  /** Existing open bench bugs indexed by `${product}||${endpoint|SYSTEMIC}||${validator}`. */
  private readonly faultIndex = new Map<string, BugSummary>();
  /** Tags of every open bench bug, for the dry-run preview's would-comment vs would-create split. */
  private readonly openTags = new Set<string>();
  /** Bugs already adopted this run, so two candidates never comment on the same ticket. */
  private readonly faultUsed = new Set<number>();

  constructor(
    private readonly client: BugzillaClient,
    private readonly config: BugzillaConfig,
    private readonly log: Logger,
  ) {}

  async file(candidates: readonly BugCandidate[]): Promise<FilingOutcome> {
    const outcome: FilingOutcome = {
      dryRun: this.config.dryRun,
      entries: [],
      counts: emptyCounts(),
    };
    if (!candidates.length) return outcome;

    const products = [...new Set(Object.values(SUITES).map((suite) => suite.bugzilla.product))];
    const metadata = await this.client.productMetadata(products);
    // Build-independent dedup: index existing open bugs by (endpoint, validator) so a fault whose
    // message SHIFTED across builds (new `[KP-]` tag) still finds its ticket and comments, never
    // duplicates. Only the products this run actually files to.
    await this.loadExisting([...new Set(candidates.map((c) => c.product))]);
    let created = 0;

    for (const candidate of candidates) {
      const target = await this.resolveTarget(candidate, metadata);
      if ('error' in target) {
        outcome.entries.push(this.entry(candidate, 'failed', { reason: target.error }));
        continue;
      }
      const prepared: BugCandidate = { ...candidate, component: target.component };

      if (this.config.dryRun) {
        // Accurate preview: would this CREATE, or comment/adopt an existing ticket?
        outcome.entries.push(this.previewEntry(prepared));
        continue;
      }
      if (this.config.maxFile > 0 && created >= this.config.maxFile) {
        outcome.entries.push(
          this.entry(prepared, 'capped', {
            reason: `BUGZILLA_MAX_FILE=${this.config.maxFile} reached`,
          }),
        );
        continue;
      }

      const entry = await this.process(prepared, target);
      if (entry.decision === 'created') created += 1;
      outcome.entries.push(entry);
    }

    for (const entry of outcome.entries) outcome.counts[entry.decision] += 1;
    return outcome;
  }

  /** Loads existing open bench bugs and indexes them by (endpoint, validator) + tag. */
  private async loadExisting(products: string[]): Promise<void> {
    this.faultIndex.clear();
    this.openTags.clear();
    this.faultUsed.clear();
    for (const product of products) {
      const found = await this.client.openBenchBugs(product, this.config.tagPrefix);
      if ('error' in found) {
        this.log.warn(`dedup: could not list open ${product} bugs — ${found.error}`);
        continue;
      }
      for (const bug of found.bugs) {
        const tag = bug.summary.match(/\[([A-Z]+-[0-9A-F]{6})\]/i)?.[1];
        if (tag) this.openTags.add(tag.toUpperCase());
        const key = faultKeyFromSummary(product, bug.summary);
        if (key && !this.faultIndex.has(key)) this.faultIndex.set(key, bug);
      }
    }
  }

  /** An existing open bug for the SAME (endpoint, validator) as this candidate, if not yet used. */
  private matchFault(candidate: BugCandidate): BugSummary | undefined {
    const key = candidateFaultKey(candidate);
    if (!key) return undefined;
    const bug = this.faultIndex.get(key);
    if (!bug || this.faultUsed.has(bug.id)) return undefined;
    return bug;
  }

  /** The would-be decision for the dry-run preview: comment (tag or fault match) vs create. */
  private previewEntry(candidate: BugCandidate): FilingEntry {
    const tag = candidate.id.replace(/^\[|\]$/g, '').toUpperCase();
    if (this.openTags.has(tag)) {
      return this.entry(candidate, 'commented', {
        reason: 'existing ticket (same tag) — would comment',
      });
    }
    const fault = this.matchFault(candidate);
    if (fault) {
      this.faultUsed.add(fault.id);
      return this.entry(candidate, 'adopted', {
        bugId: fault.id,
        reason:
          'same (endpoint, validator) under a shifted fingerprint — would comment, not duplicate',
      });
    }
    return this.entry(candidate, 'would-file');
  }

  /** Validates product, component, version and assignee against the live instance. */
  private async resolveTarget(
    candidate: BugCandidate,
    metadata: Map<string, ProductMetadata>,
  ): Promise<FilingTarget | { error: string }> {
    const product = metadata.get(candidate.product);
    if (!product)
      return { error: `product "${candidate.product}" does not exist or is not accessible` };

    const fallback = suiteFor(candidate.suiteId).bugzilla.fallbackComponent;
    let component = candidate.component;
    if (!product.components.has(component)) {
      if (!product.components.has(fallback)) {
        return {
          error: `neither component "${component}" nor fallback "${fallback}" exists in "${product.name}"`,
        };
      }
      this.log.warn(
        `component "${component}" not in "${product.name}" — filing under "${fallback}"`,
      );
      component = fallback;
    }
    const version = product.versions.has(candidate.version)
      ? candidate.version
      : ([...product.versions][0] ?? candidate.version);

    return { component, version, assignee: await this.verifiedAssignee(candidate.assignee) };
  }

  private async verifiedAssignee(email: string): Promise<string | undefined> {
    if (this.config.dryRun) return email;
    const cached = this.knownAssignees.get(email);
    if (cached !== undefined) return cached ? email : undefined;

    const exists = await this.client.userExists(email);
    this.knownAssignees.set(email, exists);
    if (!exists) {
      this.log.warn(
        `assignee "${email}" could not be verified — leaving the component default owner`,
      );
    }
    return exists ? email : undefined;
  }

  private async process(candidate: BugCandidate, target: FilingTarget): Promise<FilingEntry> {
    const found = await this.client.findByTag(candidate.id);
    if ('error' in found) {
      // Never create after a failed search: the ticket may already exist and we cannot see it.
      return this.entry(candidate, 'failed', { reason: `dedupe search failed: ${found.error}` });
    }

    // Match only tickets in the candidate's OWN product. A platform-wide fault files one ticket PER
    // product (the same `[KP-]` tag can exist on both a KPost and a KMail ticket), so a KMail finding
    // must dedupe onto the KMail ticket and never comment on / reopen the KPost one. The tag is
    // unchanged, so nothing already filed is orphaned or duplicated — only the CHOICE of which
    // ticket to match is product-scoped. If the tag exists only under a sibling product, this
    // correctly falls through to CREATE the missing ticket in the right product.
    const bugs = found.bugs.filter(
      (bug) => bug.product === undefined || bug.product === candidate.product,
    );

    const open = bugs.find((bug) => bug.is_open);
    if (open) {
      const result = await this.client.addComment(open.id, buildReproducedComment(candidate));
      if (!('error' in result)) await this.attachProof(open.id, candidate);
      return 'error' in result
        ? this.entry(candidate, 'failed', { reason: result.error, bugId: open.id })
        : this.entry(candidate, 'commented', { bugId: open.id });
    }

    const judged = bugs.find((bug) =>
      JUDGED_NOT_A_DEFECT.has((bug.resolution ?? '').toUpperCase()),
    );
    if (judged) {
      return this.entry(candidate, 'judged-skip', {
        bugId: judged.id,
        reason: `bug ${judged.id} is closed as ${judged.resolution} — a human judged this not a defect`,
      });
    }

    const resolved = bugs.find((bug) => bug.resolution);
    if (resolved) {
      const result = await this.client.reopen(
        resolved.id,
        buildReopenComment(candidate, String(resolved.resolution)),
      );
      if (!('error' in result)) await this.attachProof(resolved.id, candidate);
      return 'error' in result
        ? this.entry(candidate, 'failed', { reason: result.error, bugId: resolved.id })
        : this.entry(candidate, 'reopened', { bugId: resolved.id });
    }

    // Build-independent dedup: a fault whose message shifted across builds (so its `[KP-]` tag no
    // longer matches) still finds its existing ticket by (endpoint, validator) and comments on it,
    // tagging it so the next run matches by tag directly. This is what stops a re-run against a
    // DIFFERENT build (devapi2 → testingapi) from duplicating every fault under a new tag.
    const faultAdopted = await this.adoptByFault(candidate);
    if (faultAdopted) return faultAdopted;

    const adopted = await this.adoptExisting(candidate);
    if (adopted) return adopted;

    const fields = buildBugFields(candidate, target);
    const created = await this.client.createBug(fields as unknown as Record<string, unknown>);
    if ('error' in created) return this.entry(candidate, 'failed', { reason: created.error });

    await this.client.attach(created.id, {
      fileName: `${candidate.id}-evidence.txt`,
      summary: `Evidence for ${candidate.id}`,
      body: buildEvidenceAttachment(candidate),
    });
    await this.attachProof(created.id, candidate);
    return this.entry(candidate, 'created', { bugId: created.id });
  }

  /**
   * Uploads a UI defect's proof — its screenshot(s) and video(s) — to the bug, so the ticket carries
   * visible evidence, not just prose. Idempotent: it skips any proof already attached (by file name),
   * so re-running never piles up duplicate screenshots on a ticket it comments on. A missing or
   * oversized file only warns; the bug itself is already filed. API defects carry no proof here — for
   * them the curl + response body in the description is the reproduction.
   */
  private async attachProof(bugId: number, candidate: BugCandidate): Promise<void> {
    const proof = candidate.proof ?? [];
    if (!proof.length) return;
    const existing = await this.client.attachmentNames(bugId);
    for (const item of proof) {
      const ext = path.extname(item.path) || '';
      const slug = item.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const fileName = `${candidate.id}-${slug}${ext}`;
      if (existing.has(fileName)) continue; // already attached on a previous run
      let data: Buffer;
      try {
        data = readFileSync(item.path);
      } catch {
        this.log.warn(`bug ${bugId}: proof file not found — ${item.path}`);
        continue;
      }
      if (data.length > MAX_PROOF_BYTES) {
        this.log.warn(
          `bug ${bugId}: proof "${item.label}" is ${Math.round(data.length / 1024 / 1024)} MB, ` +
            `over the ${MAX_PROOF_MB} MB cap — skipped.`,
        );
        continue;
      }
      await this.client.attachFile(bugId, {
        fileName,
        summary: `${item.label} — proof for ${candidate.id}`,
        data,
        contentType: item.contentType,
      });
    }
  }

  /**
   * Comments on the existing OPEN bug for the SAME (endpoint, validator) as this candidate, when the
   * `[KP-]` tag no longer matches because the build changed the error message. Tags the ticket with
   * the new tag so the next run dedupes by tag directly.
   */
  private async adoptByFault(candidate: BugCandidate): Promise<FilingEntry | undefined> {
    const match = this.matchFault(candidate);
    if (!match) return undefined;
    this.faultUsed.add(match.id);
    const comment = await this.client.addComment(match.id, buildReproducedComment(candidate));
    if ('error' in comment)
      return this.entry(candidate, 'failed', { reason: comment.error, bugId: match.id });
    await this.client.appendWhiteboard(match.id, match.whiteboard ?? '', candidate.id);
    await this.attachProof(match.id, candidate);
    return this.entry(candidate, 'adopted', {
      bugId: match.id,
      reason: 'same (endpoint, validator) fault under a shifted fingerprint',
    });
  }

  /**
   * Finds an OPEN ticket describing the same fault that simply predates our tag (for example one
   * filed by the previous bench or by a human), comments on it and tags it, so this run does not
   * add a second ticket for a problem the team already tracks.
   */
  private async adoptExisting(candidate: BugCandidate): Promise<FilingEntry | undefined> {
    const phrase = summaryPhrase(candidate);
    if (phrase.length < 20) return undefined;
    const found = await this.client.findOpenByPhrase(
      candidate.product,
      candidate.component,
      phrase,
    );
    if ('error' in found)
      return this.entry(candidate, 'failed', { reason: `duplicate search failed: ${found.error}` });

    const match = found.bugs.find((bug) => sameFault(bug.summary, buildSummary(candidate)));
    if (!match) return undefined;

    const comment = await this.client.addComment(match.id, buildAdoptionComment(candidate));
    if ('error' in comment)
      return this.entry(candidate, 'failed', { reason: comment.error, bugId: match.id });
    await this.client.appendWhiteboard(match.id, match.whiteboard ?? '', candidate.id);
    return this.entry(candidate, 'adopted', {
      bugId: match.id,
      reason: 'an open ticket already describes this fault',
    });
  }

  private entry(
    candidate: BugCandidate,
    decision: FilingDecision,
    extra: { bugId?: number; reason?: string } = {},
  ): FilingEntry {
    return {
      id: candidate.id,
      decision,
      summary: buildSummary(candidate),
      product: candidate.product,
      component: candidate.component,
      assignee: candidate.assignee,
      severity: candidate.severity,
      /*
       * The full ticket text, on a dry run only.
       *
       * A dry run whose artifact holds nothing but summaries cannot be reviewed - and reviewing
       * what will be filed is the entire point of having one. On a live run it is omitted: the
       * text is already in Bugzilla, and duplicating it here would bloat the artifact.
       */
      ...(this.config.dryRun ? { description: buildDescription(candidate) } : {}),
      ...extra,
    };
  }
}

/**
 * A build-independent fault key from a bug SUMMARY: `${product}||${endpoint|SYSTEMIC}||${validator}`.
 * Undefined when the validator or endpoint can't be pinned down confidently — a weak signal must
 * never merge two different faults into one ticket, so we would rather file than wrongly dedup.
 */
function faultKeyFromSummary(product: string, summary: string): string | undefined {
  const validator = normalizeValidator(summary);
  if (validator === 'other' || validator === 'response.time') return undefined;
  if (/platform-wide/i.test(summary)) return `${product}||SYSTEMIC||${validator}`;
  const m = summary.match(/\]\s*(GET|POST|PUT|DELETE|PATCH)\s+(\/\S+?):/i);
  if (!m) return undefined;
  return `${product}||${normalizeEndpoint(`${m[1]} ${m[2]}`)}||${validator}`;
}

/** The same key from a candidate, so a finding matches its existing ticket across a build change. */
function candidateFaultKey(candidate: BugCandidate): string | undefined {
  const validator = normalizeValidator(candidate.classification || candidate.title);
  if (validator === 'other' || validator === 'response.time') return undefined;
  if (candidate.systemic) return `${candidate.product}||SYSTEMIC||${validator}`;
  if (!candidate.endpoint) return undefined;
  return `${candidate.product}||${normalizeEndpoint(candidate.endpoint)}||${validator}`;
}
