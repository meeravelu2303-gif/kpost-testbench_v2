import type { BugSummary } from './bugzilla-client';
import type { ValidationReport } from '../validation-engine/validation-result';

/**
 * Deciding which OPEN, bench-filed bugs this run VERIFIED as fixed — so they can be auto-closed
 * (RESOLVED/FIXED) instead of lingering open after the developer has already fixed them.
 *
 * The safety rule, and why it is safe: a bug is resolved ONLY when the exact check that filed it —
 * its (endpoint, validator) — actually RAN this run and did NOT fail. If the endpoint was skipped
 * or the validator did not execute, the run proved nothing and the bug stays open. And if the
 * bench is wrong, it self-corrects: a later run that finds the fault again REOPENS the ticket. So
 * the worst case is a temporary wrong-close that the next run undoes — never a lost defect.
 *
 * Verification is at the (endpoint, validator) level on purpose. Matching by the `[KP-]` tag alone
 * would be fooled by a "fingerprint shift" (the build changes an error message, the tag changes,
 * and the same fault looks gone) — so we check the underlying behaviour, not the tag.
 */

/** Normalizes a validator NAME (from the run) or a bug SUMMARY (free text) to one shared class. */
export function normalizeValidator(text: string): string {
  const t = text.toLowerCase();
  if (/security[- ]?headers/.test(t)) return 'security.security-headers';
  if (/missing[- ]?token|no authorization header/.test(t)) return 'auth.missing-token';
  if (/malformed[- ]?token/.test(t)) return 'auth.malformed-token';
  if (/invalid[- ]?token|tampered signature|foreign key/.test(t)) return 'auth.invalid-token';
  if (/\bjwt\b|alg[- ]?none|unsigned/.test(t)) return 'security.jwt';
  if (/sensitive|password|aadhaar|\bpan\b/.test(t)) return 'security.sensitive-data';
  if (/null[- ]?value|null value/.test(t)) return 'request.null-value';
  if (/invalid[- ]?payload|array instead of object|root\)/.test(t))
    return 'request.invalid-payload';
  if (/data[- ]?type|instead of (string|integer|array|object|number|boolean)/.test(t))
    return 'request.data-type';
  if (/empty[- ]?body|empty json object/.test(t)) return 'request.empty-body';
  if (/empty[- ]?value/.test(t)) return 'request.empty-value';
  if (/method[- ]?not[- ]?allowed/.test(t)) return 'request.method-not-allowed';
  if (/unsupported[- ]?media/.test(t)) return 'request.unsupported-media-type';
  if (/malformed[- ]?json/.test(t)) return 'request.malformed-json';
  if (/api[- ]?error/.test(t)) return 'common.api-error';
  if (/error[- ]?format|error envelope|error status must be|error responses failed/.test(t))
    return 'response.error-format';
  if (/content[- ]?type/.test(t)) return 'response.content-type';
  if (/structure|schema|not valid json|response body is not/.test(t)) return 'response.structure';
  if (/response[- ]?time|slow|budget|performance|too slow/.test(t)) return 'response.time';
  if (/status[- ]?code|expected \d+, got \d+|expected \[?\d+|server error 500/.test(t))
    return 'response.status-code';
  return 'other';
}

/** METHOD + path, upper-cased and trailing-slash-stripped, so run and bug agree. */
export function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\s+/g, ' ').replace(/\/+$/, '').trim().toUpperCase();
}

/**
 * Validator classes we never auto-resolve, because "it passed this run" is not proof of a fix:
 * a response-time / performance check is environmental and flaps between runs.
 */
const NON_VERIFIABLE = new Set(['response.time', 'other']);

export interface RunIndex {
  /** `${endpoint}||${validator}` that FAILED this run. */
  failedPair: Set<string>;
  /** `${endpoint}||${validator}` that RAN (passed or failed) this run. */
  ranPair: Set<string>;
  /** Endpoints exercised this run (at least one non-skipped check). */
  ranEndpoint: Set<string>;
  /** Validator classes that failed on ANY endpoint. */
  failedClass: Set<string>;
  /** Validator classes that ran on ANY endpoint. */
  ranClass: Set<string>;
}

export function buildRunIndex(reports: readonly ValidationReport[]): RunIndex {
  const idx: RunIndex = {
    failedPair: new Set(),
    ranPair: new Set(),
    ranEndpoint: new Set(),
    failedClass: new Set(),
    ranClass: new Set(),
  };
  for (const report of reports) {
    for (const r of report.results) {
      if (r.status === 'SKIPPED') continue; // a skipped check verified nothing
      const endpoint = normalizeEndpoint(r.endpoint);
      const cls = normalizeValidator(r.validatorName);
      const pair = `${endpoint}||${cls}`;
      idx.ranPair.add(pair);
      idx.ranEndpoint.add(endpoint);
      idx.ranClass.add(cls);
      if (r.status === 'FAILED') {
        idx.failedPair.add(pair);
        idx.failedClass.add(cls);
      }
    }
  }
  return idx;
}

export interface ResolveDecision {
  action: 'resolve' | 'keep';
  reason: string;
  endpoint?: string;
  validator: string;
  systemic: boolean;
}

const ENDPOINT_RE = /\]\s*(GET|POST|PUT|DELETE|PATCH)\s+(\/\S+?):/i;

/**
 * The endpoints a systemic ticket lists in its description ("Affects N endpoints — …\n  - GET /x\n …"),
 * plus the "Representative endpoint:" line — the scope to verify that ticket against.
 */
export function parseAffectedEndpoints(description: string): string[] {
  const eps = new Set<string>();
  for (const m of description.matchAll(/^\s*-\s+(GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)\s*$/gim)) {
    eps.add(`${m[1]} ${m[2]}`);
  }
  const rep = description.match(
    /Representative endpoint:\s*(GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)/i,
  );
  if (rep) eps.add(`${rep[1]} ${rep[2]}`);
  return [...eps];
}

/**
 * Decides whether one open bench bug was verified fixed this run. An endpoint-specific bug is fixed
 * only when its own (endpoint, validator) ran and passed. A systemic (platform-wide) bug is verified
 * against the endpoints IT LISTS (`affectedEndpoints`, parsed from its description) — a platform fault
 * that no longer fails on any of the ticket's own endpoints is fixed FOR THAT TICKET, even if the same
 * class still fails on an unrelated endpoint (that unrelated failure is a different ticket). Only when
 * the ticket's affected endpoints are unknown does it fall back to the global "fails nowhere" check.
 */
export function classifyResolve(
  bug: BugSummary,
  index: RunIndex,
  reproducedTags: ReadonlySet<string>,
  affectedEndpoints?: readonly string[],
): ResolveDecision {
  const systemic = /platform-wide/i.test(bug.summary);
  const validator = normalizeValidator(bug.summary);

  // A fault the bench reproduced this run is obviously not fixed (belt-and-suspenders).
  const tag = bug.summary.match(/\[([A-Z]+-[0-9A-F]{6})\]/i)?.[1];
  if (tag && reproducedTags.has(tag)) {
    return { action: 'keep', reason: 'reproduced this run', validator, systemic };
  }
  if (NON_VERIFIABLE.has(validator)) {
    return {
      action: 'keep',
      reason: `validator "${validator}" is environmental — not auto-verified`,
      validator,
      systemic,
    };
  }

  if (systemic) {
    const own = (affectedEndpoints ?? []).map(normalizeEndpoint);
    if (own.length) {
      // Verify against the ticket's OWN endpoints — the accurate scope.
      const tested = own.filter((ep) => index.ranEndpoint.has(ep));
      if (!tested.length) {
        return {
          action: 'keep',
          reason: `none of the ticket's ${own.length} endpoint(s) were exercised this run`,
          validator,
          systemic,
        };
      }
      const stillFailing = tested.filter((ep) => index.failedPair.has(`${ep}||${validator}`));
      if (stillFailing.length) {
        return {
          action: 'keep',
          reason: `"${validator}" still fails on ${stillFailing[0]}`,
          validator,
          systemic,
        };
      }
      return {
        action: 'resolve',
        reason: `"${validator}" ran and passed on all ${tested.length} of this ticket's endpoint(s)`,
        validator,
        systemic,
      };
    }
    // No affected-endpoint list available — fall back to the global class check.
    if (!index.ranClass.has(validator)) {
      return {
        action: 'keep',
        reason: `class "${validator}" not exercised this run`,
        validator,
        systemic,
      };
    }
    if (index.failedClass.has(validator)) {
      return {
        action: 'keep',
        reason: `class "${validator}" still fails somewhere`,
        validator,
        systemic,
      };
    }
    return {
      action: 'resolve',
      reason: `platform-wide "${validator}" ran and no longer fails on any endpoint`,
      validator,
      systemic,
    };
  }

  const m = bug.summary.match(ENDPOINT_RE);
  if (!m) {
    return { action: 'keep', reason: 'could not parse endpoint from summary', validator, systemic };
  }
  const endpoint = normalizeEndpoint(`${m[1]} ${m[2]}`);
  const pair = `${endpoint}||${validator}`;
  if (!index.ranEndpoint.has(endpoint)) {
    return {
      action: 'keep',
      reason: `endpoint not tested this run (${endpoint})`,
      endpoint,
      validator,
      systemic,
    };
  }
  if (!index.ranPair.has(pair)) {
    return {
      action: 'keep',
      reason: `validator "${validator}" did not run on ${endpoint}`,
      endpoint,
      validator,
      systemic,
    };
  }
  if (index.failedPair.has(pair)) {
    return {
      action: 'keep',
      reason: `still failing on ${endpoint}`,
      endpoint,
      validator,
      systemic,
    };
  }
  return {
    action: 'resolve',
    reason: `${endpoint} "${validator}" ran and passed`,
    endpoint,
    validator,
    systemic,
  };
}
