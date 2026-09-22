import type { BugCandidate } from './bug-candidate';
import type { BugzillaClient } from './bugzilla-client';
import { candidateRejection } from './validity-gate';

/**
 * The one gate every bug passes through before it reaches Bugzilla.
 *
 * Before this existed, two filing paths had two different standards: the engine ran the validity
 * gate and deduped, while a hand-authored finding (`manual-bug.spec.ts`) only deduped — so a person
 * filing by hand could create a ticket the automated path would have rejected as a bench fault. This
 * closes that: automated and manual filings now make the SAME decision, here, and nowhere else.
 *
 * The gate answers one question — *may this be filed, right now?* — in four ordered stages, cheapest
 * and most certain first:
 *
 *   1. EVIDENCE      the finding is actionable at all (endpoint, expected, actual, a reproduction
 *                    verdict). A ticket a developer cannot act on is worse than no ticket.
 *   2. VALIDITY      it is a product defect, not a bench/infra/transient fault. This is the existing
 *                    `candidateRejection` — the accumulated set of real false positives.
 *   3. REPRODUCED    the reproduction gate confirmed it (every pass failed). A one-off is a flake.
 *   4. DEDUPLICATED  Bugzilla does not already hold it — open (comment instead) or closed-as-not-a-
 *                    defect (a human judged it; never re-file).
 *
 * Only a candidate that clears all four is FILE. Everything else carries the reason, so the preview
 * explains every decision rather than silently dropping tickets.
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
 * Stage 1 — evidence. Kept here rather than in the validity gate because it is about the TICKET's
 * usefulness, not the finding's truth: a real defect with no expected/actual still cannot be worked.
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
 * Stage 3 — reproduction. The gate REQUIRES a verdict: a finding that never went through the
 * reproduction gate has `reproduction` undefined, and that is itself a reason to withhold it, because
 * "did it fail every time?" is the question that separates a defect from a flake. A caller that
 * genuinely cannot reproduce (a one-shot manual observation) must say so by setting
 * `{ attempts: 1, failures: 1 }` deliberately, which documents that it was seen once.
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

/**
 * The static half of the gate — everything decidable without touching Bugzilla. Pure, so it is
 * unit-testable and the preview can show exactly why a candidate would be dropped, offline.
 */
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
 * The full gate, including the live duplicate check. Async because the last stage asks Bugzilla.
 *
 * A dedup lookup that ERRORS (network, auth) returns `ERROR`, and the caller must treat that as
 * "do not file" — a transient search failure must never be read as "no duplicate exists" and used to
 * justify creating one. That is the single rule that stops a flaky connection from doubling every
 * ticket in the tracker.
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

  // Phrase match: a different run may have filed the same endpoint defect under a different tag
  // (the engine's hash tag vs a hand-authored one). Caught on the endpoint path in the summary.
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
    // A phrase-search error is NOT fatal here: the fingerprint check above already passed cleanly,
    // which is the authoritative dedup. The phrase check is a best-effort second net.
  }

  return { decision: 'FILE', reason: 'no existing bug found — safe to file' };
}
