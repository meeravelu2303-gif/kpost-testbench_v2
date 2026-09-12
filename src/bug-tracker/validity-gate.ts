import { meetsSeverityFloor } from '@config/bugzilla.config';
import type { BugCandidate } from './bug-candidate';

/**
 * Two gates stand between a failing run and a Bugzilla ticket. Filing is irreversible (Bugzilla
 * has no delete, only resolve), so an invalid ticket costs a human's time forever.
 *
 * 1. The RUN gate — is this run trustworthy at all?
 * 2. The CANDIDATE gate — does this finding's own evidence support its claim?
 *
 * Both are deliberately narrow. A gate that guesses suppresses real defects, which is worse
 * than letting a weak one through, so every rule below rejects only what can be read off the
 * record itself. Every suppression is reported, never silent.
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

/**
 * A bench that cannot run must be loud, never clean — and must never file. A run where every
 * spec failed to import produces zero findings, which is indistinguishable from a healthy API
 * unless this gate says otherwise.
 */
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
 * Why this candidate must not be filed, or undefined when it may be.
 *
 * The evidence rules come from real false positives: a claim that data was exposed cannot rest
 * on a response the server refused (401/403), and a claim that identifiers are enumerable
 * cannot rest on a 404 where nothing resolved.
 */
export function candidateRejection(candidate: BugCandidate): string | undefined {
  if (!meetsSeverityFloor(candidate.severity)) {
    return `severity ${candidate.severity} is below the filing floor`;
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
