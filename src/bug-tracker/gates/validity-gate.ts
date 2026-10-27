import { meetsSeverityFloor } from '@config/bugzilla.config';
import { SETUP_STEP_MARKER } from '@ui/setup-step';
import type { BugCandidate } from '../findings/bug-candidate';
import { knownFalsePositiveReason } from './known-false-positives';

/**
 * The run gate (is this run trustworthy?) and the candidate gate (does the finding's own evidence
 * support it?). Filing is irreversible, but a guessing gate hides real defects, so each rule
 * rejects only what the record shows, and every rejection is reported.
 */

export interface RunValidityInput {
  /** Tests that produced a result. */
  executed: number;
  /** Tests Playwright collected for this invocation, after any filter. */
  collected: number;
  /** Errors outside any test: spec files that failed to load, global setup faults. */
  loadErrors: number;
  /** Playwright's own verdict. */
  status?: string;
}

export interface RunValidity {
  valid: boolean;
  reason: string;
}

/** Below this share of collected tests, the run collapsed and its findings are a partial sample. */
const MIN_EXECUTION_RATIO = 0.5;

/** A collapsed run must be loud and never file: no findings from a broken bench looks healthy. */
export function assessRunValidity(input: RunValidityInput): RunValidity {
  const { executed, collected, loadErrors, status } = input;

  if (loadErrors > 0) {
    return {
      valid: false,
      reason: `${loadErrors} error(s) occurred outside any test — specs failed to load or setup faulted, so nothing was actually checked`,
    };
  }
  if (status === 'interrupted' || status === 'timedout') {
    return {
      valid: false,
      reason: `the run was ${status}, so its findings are a partial sample of unknown size`,
    };
  }
  if (executed === 0) {
    return {
      valid: false,
      reason: 'zero tests executed — an empty run is not evidence of anything',
    };
  }
  if (collected > 0 && executed < collected * MIN_EXECUTION_RATIO) {
    return {
      valid: false,
      reason: `only ${executed} of ${collected} collected tests produced a result (under ${Math.round(MIN_EXECUTION_RATIO * 100)}%) — the run collapsed part-way`,
    };
  }
  return { valid: true, reason: `${executed} of ${collected} collected tests executed` };
}

/** Infrastructure and bench faults. These are not product defects and must never be filed. */
const BENCH_FAULT = [
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network error/i,
  /no response within|apiRequestContext\.\w+: (connect|request)/i,
  /Target (page|browser|context) (has been )?closed|browser has been closed|context was destroyed/i,
  /validator error:/i,
  /Setup call ".*" returned|No principal configured|is not configured/i,
  /ProductionSafetyError/i,
];

/**
 * The app could not be reached or did not answer (API timeouts and each browser's network errors).
 * Never filed, and never proof that a bug is still broken.
 */
export const ENVIRONMENTAL_UI_OR_API_FAILURE =
  /no HTTP response|apiRequestContext\.fetch|Timeout\s*\d+\s*ms exceeded|Test timeout of \d+\s*ms exceeded|NS_ERROR_[A-Z_]+|net::ERR_[A-Z_]+|Could not connect to (the )?server|ERR_CONNECTION|page\.goto: Timeout was reached|is interrupted by another navigation|interrupted by another navigation to|frame was detached|Execution context was destroyed|auth session dropped|lost its login session|Could not resolve hostname|The network connection was lost|A server with the specified hostname could not be found/i;

/** The endpoint throttled US: the server working correctly under test load, not a defect. */
const THROTTLED = /\b429\b|Too many requests|RATE_LIMITED/i;

const CLAIMS_EXPOSURE =
  /expos|disclos|leak|bypass|another (user|company|tenant)|cross-tenant|enumerat|escalat/i;
const CLAIMS_ENUMERATION = /enumerat/i;

function statusIn(text: string): number | undefined {
  const match = /\bHTTP (\d{3})\b/.exec(text) ?? /"?status"?\s*[:=]\s*(\d{3})/.exec(text);
  return match ? Number(match[1]) : undefined;
}

/**
 * Why this candidate must not be filed, or undefined. E.g. "data exposed" cannot rest on a 401/403,
 * and "ids enumerable" cannot rest on a 404.
 */
export function candidateRejection(candidate: BugCandidate): string | undefined {
  // Checked first, so a reviewer's judgment is the recorded reason.
  const knownFp = knownFalsePositiveReason(candidate);
  if (knownFp) return knownFp;

  if (!meetsSeverityFloor(candidate.severity)) {
    return `severity ${candidate.severity} is below the filing floor`;
  }

  // A standalone response-time finding is environmental; a real timeout files via the cascade.
  if (/^performance\.(response-time|timeout)$|^response\.time$/.test(candidate.classification)) {
    return 'a response-time / timeout check is environmental (it flaps between runs), not a filed defect';
  }

  // A gateway 502/503/504 or no response is transient; an app 500/501 still files.
  const transient = `${candidate.actual} ${candidate.title} ${candidate.narrative}`;
  if (
    candidate.responseStatus === 502 ||
    candidate.responseStatus === 503 ||
    candidate.responseStatus === 504 ||
    /\bgot 50[234]\b/i.test(transient) ||
    ENVIRONMENTAL_UI_OR_API_FAILURE.test(transient)
  ) {
    return 'a gateway 5xx (502/503/504) or a no-response/timeout is a transient upstream failure (the app did not respond), not a product defect';
  }

  // Failed at a marked setup step (src/ui/setup-step.ts), so the named check never ran.
  if (`${candidate.actual} ${candidate.title}`.includes(SETUP_STEP_MARKER)) {
    return 'a setup step failed (the test stopped before its own check), so this is not evidence of the defect it names';
  }

  const evidence = `${candidate.actual}`;
  const claim = `${candidate.title} ${candidate.narrative}`;

  for (const pattern of BENCH_FAULT) {
    if (pattern.test(evidence) || pattern.test(candidate.title)) {
      return 'the evidence describes an infrastructure or bench fault, not a product defect';
    }
  }

  // A rate-limit validator asserting that throttling is ABSENT is the opposite case, and files.
  if (THROTTLED.test(evidence) && !/rate-limit/i.test(candidate.classification)) {
    return 'the endpoint throttled the test run (429), so the response is not evidence of a defect';
  }

  const status = statusIn(evidence);
  if (status !== undefined && CLAIMS_EXPOSURE.test(claim) && (status === 401 || status === 403)) {
    return `claims exposure or bypass, but the recorded response is HTTP ${status} — the server refused the request`;
  }
  if (status === 404 && CLAIMS_ENUMERATION.test(claim)) {
    return 'claims identifiers are enumerable, but the recorded response is HTTP 404 — nothing resolved';
  }

  if (!candidate.component) return 'no Bugzilla component could be resolved for this defect';
  if (candidate.expected === '(none)' && candidate.actual === '(none)') {
    return 'the finding carries no expected/actual evidence, so the ticket would not be actionable';
  }
  return undefined;
}

/**
 * Why a `flow.server-error` must be verified by hand before it creates or reopens a ticket: a
 * one-off 5xx with no reproduction score, often intermittent. Commenting on an open ticket stays
 * automatic.
 */
export function flowFindingHoldReason(candidate: BugCandidate): string | undefined {
  if (candidate.classification !== 'flow.server-error') return undefined;
  return (
    'a server error seen once during a lifecycle flow has no reproduction score and no replayable ' +
    'request, so it was held for a live replay of the original request before any ticket is created or reopened'
  );
}

/** Why a brand-new candidate should be held for review rather than filed; create path only. */
export function uncertainNewDefect(candidate: BugCandidate): string | undefined {
  const flowHold = flowFindingHoldReason(candidate);
  if (flowHold) return flowHold;
  const { reproduction } = candidate;
  if (reproduction && reproduction.failures < reproduction.attempts) {
    return (
      `only reproduced ${reproduction.failures} of ${reproduction.attempts} attempts — not a ` +
      'reliable repro, so this was held for manual review instead of auto-filed as a confirmed new defect'
    );
  }
  return undefined;
}

export interface GateOutcome {
  filed: BugCandidate[];
  rejected: { candidate: BugCandidate; reason: string }[];
}

/** Applies the candidate gate to a whole batch, keeping the rejections for the report. */
export function applyValidityGate(candidates: readonly BugCandidate[]): GateOutcome {
  const outcome: GateOutcome = { filed: [], rejected: [] };
  for (const candidate of candidates) {
    const reason = candidateRejection(candidate);
    if (reason) outcome.rejected.push({ candidate, reason });
    else outcome.filed.push(candidate);
  }
  return outcome;
}
