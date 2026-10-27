import type { BugCandidate } from '../findings/bug-candidate';
import type { BugzillaClient } from '../bugzilla/bugzilla-client';
import { candidateRejection } from './validity-gate';

/**
 * The one gate automated and manual filings both pass: EVIDENCE (actionable), VALIDITY (not a bench
 * fault), REPRODUCED (every pass failed), DEDUPLICATED (not already in Bugzilla). Every refusal
 * carries a reason.
 */

export type GateDecision = 'FILE' | 'REJECT' | 'DUPLICATE' | 'JUDGED_NOT_DEFECT' | 'ERROR';

export interface GateVerdict {
  decision: GateDecision;
  reason: string;
  /** For DUPLICATE / JUDGED_NOT_DEFECT: the bug that already covers it. */
  existingId?: number;
}

/** Resolutions a human sets to say "this is not a defect". Never re-filed, never re-opened by a bot. */
const JUDGED_NOT_A_DEFECT = new Set(['INVALID', 'WONTFIX', 'WORKSFORME', 'DUPLICATE']);

/**
 * Stage 1: the ticket is actionable (a real defect with no expected/actual still cannot be worked).
 */
function evidenceRejection(candidate: BugCandidate): string | undefined {
  if (!candidate.id) return 'no fingerprint id — deduplication depends on it';
  if (!candidate.endpoint && candidate.source === 'api') {
    return 'an API finding must name the endpoint it is about';
  }
  const hasExpected = candidate.expected && candidate.expected !== '(none)';
  const hasActual = candidate.actual && candidate.actual !== '(none)';
  if (!hasExpected || !hasActual) {
    return 'no expected/actual evidence — the ticket would not be actionable';
  }
  return undefined;
}

/**
 * Stage 3: a reproduction verdict is required. A one-shot manual observation must set `{ attempts:
 * 1, failures: 1 }` explicitly.
 */
function reproductionRejection(candidate: BugCandidate): string | undefined {
  const r = candidate.reproduction;
  if (!r) {
    return 'no reproduction verdict — run it through the 3-pass gate, or set reproduction explicitly';
  }
  if (r.failures < r.attempts) {
    return `intermittent — only ${r.failures}/${r.attempts} passes failed, so it is a flake, not a filed defect`;
  }
  return undefined;
}

/** The gate's static half, decidable offline without Bugzilla. */
export function staticVerdict(candidate: BugCandidate): GateVerdict {
  const evidence = evidenceRejection(candidate);
  if (evidence) return { decision: 'REJECT', reason: evidence };

  const validity = candidateRejection(candidate);
  if (validity) return { decision: 'REJECT', reason: validity };

  const repro = reproductionRejection(candidate);
  if (repro) return { decision: 'REJECT', reason: repro };

  return { decision: 'FILE', reason: 'passed evidence, validity and reproduction checks' };
}

/**
 * The full gate, including the live duplicate check. A failed lookup returns `ERROR`, which means
 * "do not file": a search failure must never read as "no duplicate exists".
 */
export async function gatekeep(
  candidate: BugCandidate,
  client: Pick<BugzillaClient, 'findByTag' | 'findOpenByPhrase'>,
): Promise<GateVerdict> {
  const stat = staticVerdict(candidate);
  if (stat.decision !== 'FILE') return stat;

  // Fingerprint match: the same defect, filed before under its [tag].
  const byTag = await client.findByTag(candidate.id);
  if ('error' in byTag) {
    return {
      decision: 'ERROR',
      reason: `dedup search failed (${byTag.error}) — refusing to file, since a failed search is not proof the bug is new`,
    };
  }
  const priorTag = byTag.bugs[0];
  if (priorTag) {
    const resolution = (priorTag.resolution ?? '').toUpperCase();
    if (!priorTag.is_open && JUDGED_NOT_A_DEFECT.has(resolution)) {
      return {
        decision: 'JUDGED_NOT_DEFECT',
        reason: `#${priorTag.id} was closed ${resolution} — a human judged this not a defect; never re-file`,
        existingId: priorTag.id,
      };
    }
    return {
      decision: 'DUPLICATE',
      reason: `already filed as #${priorTag.id} (${priorTag.is_open ? 'open' : resolution || 'closed'}) — comment, do not duplicate`,
      existingId: priorTag.id,
    };
  }

  // Phrase match: the same endpoint defect may exist under a different tag.
  if (candidate.endpoint) {
    const byPhrase = await client.findOpenByPhrase(
      candidate.product,
      candidate.component,
      candidate.endpoint,
    );
    if (!('error' in byPhrase)) {
      const near = byPhrase.bugs.find((b) => b.summary.includes(candidate.endpoint ?? '\0'));
      if (near) {
        return {
          decision: 'DUPLICATE',
          reason: `an open bug (#${near.id}) already names ${candidate.endpoint} in this component — likely the same defect; comment, do not duplicate`,
          existingId: near.id,
        };
      }
    }
    // A phrase-search error is not fatal: the tag check above is the authoritative dedup.
  }

  return { decision: 'FILE', reason: 'no existing bug found — safe to file' };
}
