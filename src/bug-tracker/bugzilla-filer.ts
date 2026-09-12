import { JUDGED_NOT_A_DEFECT, type BugzillaConfig } from '@config/bugzilla.config';
import type { Logger } from '@utils/logger';
import {
  buildAdoptionComment,
  buildBugFields,
  buildEvidenceAttachment,
  buildReopenComment,
  buildReproducedComment,
  buildSummary,
  sameFault,
  summaryPhrase,
} from './bug-builder';
import type { BugCandidate } from './bug-candidate';
import type { BugzillaClient, ProductMetadata } from './bugzilla-client';

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
 */

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
  component: string;
  product: string;
  severity: string;
  reason?: string;
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

export class BugzillaFiler {
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

    const metadata = await this.client.productMetadata([
      this.config.apiProduct,
      this.config.uiProduct,
    ]);
    let created = 0;

    for (const candidate of candidates) {
      const target = this.resolveTarget(candidate, metadata);
      if ('error' in target) {
        outcome.entries.push(this.entry(candidate, 'failed', { reason: target.error }));
        continue;
      }
      const prepared: BugCandidate = { ...candidate, component: target.component };

      if (this.config.dryRun) {
        outcome.entries.push(this.entry(prepared, 'would-file'));
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

      const entry = await this.process(prepared, target.version);
      if (entry.decision === 'created') created += 1;
      outcome.entries.push(entry);
    }

    for (const entry of outcome.entries) outcome.counts[entry.decision] += 1;
    return outcome;
  }

  /** Validates product/component/version against the live instance before anything is filed. */
  private resolveTarget(
    candidate: BugCandidate,
    metadata: Map<string, ProductMetadata>,
  ): { component: string; version: string } | { error: string } {
    const product = metadata.get(candidate.product);
    if (!product)
      return { error: `product "${candidate.product}" does not exist or is not accessible` };

    const fallback =
      candidate.source === 'ui'
        ? this.config.uiFallbackComponent
        : this.config.apiFallbackComponent;
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
    const version = product.versions.has(this.config.version)
      ? this.config.version
      : ([...product.versions][0] ?? this.config.version);
    return { component, version };
  }

  private async process(candidate: BugCandidate, version: string): Promise<FilingEntry> {
    const found = await this.client.findByTag(candidate.id);
    if ('error' in found) {
      // Never create after a failed search: the ticket may already exist and we cannot see it.
      return this.entry(candidate, 'failed', { reason: `dedupe search failed: ${found.error}` });
    }

    const open = found.bugs.find((bug) => bug.is_open);
    if (open) {
      const result = await this.client.addComment(open.id, buildReproducedComment(candidate));
      return 'error' in result
        ? this.entry(candidate, 'failed', { reason: result.error, bugId: open.id })
        : this.entry(candidate, 'commented', { bugId: open.id });
    }

    const judged = found.bugs.find((bug) =>
      JUDGED_NOT_A_DEFECT.has((bug.resolution ?? '').toUpperCase()),
    );
    if (judged) {
      return this.entry(candidate, 'judged-skip', {
        bugId: judged.id,
        reason: `bug ${judged.id} is closed as ${judged.resolution} — a human judged this not a defect`,
      });
    }

    const resolved = found.bugs.find((bug) => bug.resolution);
    if (resolved) {
      const result = await this.client.reopen(
        resolved.id,
        buildReopenComment(candidate, String(resolved.resolution)),
      );
      return 'error' in result
        ? this.entry(candidate, 'failed', { reason: result.error, bugId: resolved.id })
        : this.entry(candidate, 'reopened', { bugId: resolved.id });
    }

    const adopted = await this.adoptExisting(candidate);
    if (adopted) return adopted;

    const fields = buildBugFields(candidate, this.config, version);
    const created = await this.client.createBug(fields as unknown as Record<string, unknown>);
    if ('error' in created) return this.entry(candidate, 'failed', { reason: created.error });

    await this.client.attach(created.id, {
      fileName: `${candidate.id}-evidence.txt`,
      summary: `Evidence for ${candidate.id}`,
      body: buildEvidenceAttachment(candidate),
    });
    return this.entry(candidate, 'created', { bugId: created.id });
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
      component: candidate.component,
      product: candidate.product,
      severity: candidate.severity,
      ...extra,
    };
  }
}
