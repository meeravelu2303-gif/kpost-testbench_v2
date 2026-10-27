import { projectForBrowser } from '@config/bugzilla.config';
import type { BugSummary } from '../bugzilla/bugzilla-client';
import type { ValidationReport } from '../../validation-engine/validation-result';

/**
 * Decides which open bench-filed bugs this run verified as fixed. A bug closes only when its own
 * (endpoint, validator) check ran and passed; matching on behaviour, not the tag, survives
 * fingerprint shifts.
 */

/** Normalizes a validator NAME (from the run) or a bug SUMMARY (free text) to one shared class. */
export function normalizeValidator(text: string): string {
  const t = text.toLowerCase();
  // Admin write-fuzz rule ids are already per-check, so each is its own class.
  const writeFuzzRule = t.match(/admin-write-fuzz-[a-z0-9-]+/);
  if (writeFuzzRule) return `business-rule.${writeFuzzRule[0]}`;
  // A lifecycle flow crash is its own class, not the generic status-code one below.
  if (/write flow received http|never crash the server/.test(t)) return 'flow.server-error';
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
  /** The failure message of each failed pair this run (first seen), quoted as proof. */
  failedMessage: Map<string, string>;
  /** `${endpoint}||${validator}` that RAN (passed or failed) this run. */
  ranPair: Set<string>;
  /** Endpoints exercised this run (at least one non-skipped check). */
  ranEndpoint: Set<string>;
  /** Validator classes that failed on ANY endpoint. */
  failedClass: Set<string>;
  /** Validator classes that ran on ANY endpoint. */
  ranClass: Set<string>;
}

/** The server never answered (timeout, dropped socket, 429): proves neither fixed nor broken. */
const ENVIRONMENTAL_FAILURE =
  /Timeout\s*\d+\s*ms exceeded|no HTTP response|Request context disposed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|\b429\b|Too many requests/i;

export function buildRunIndex(reports: readonly ValidationReport[]): RunIndex {
  const idx: RunIndex = {
    failedPair: new Set(),
    failedMessage: new Map(),
    ranPair: new Set(),
    ranEndpoint: new Set(),
    failedClass: new Set(),
    ranClass: new Set(),
  };
  for (const report of reports) {
    for (const r of report.results) {
      if (r.status === 'SKIPPED') continue; // a skipped check verified nothing
      if (r.status === 'FAILED') {
        const text = `${r.message} ${r.error?.message ?? ''}`;
        // Drop only failures with no real HTTP answer; a mixed multi-case failure is evidence.
        if (ENVIRONMENTAL_FAILURE.test(text) && !/\bgot \d{3}\b/i.test(text)) continue;
      }
      const endpoint = normalizeEndpoint(r.endpoint);
      const cls = normalizeValidator(r.validatorName);
      const pair = `${endpoint}||${cls}`;
      idx.ranPair.add(pair);
      idx.ranEndpoint.add(endpoint);
      idx.ranClass.add(cls);
      if (r.status === 'FAILED') {
        idx.failedPair.add(pair);
        if (!idx.failedMessage.has(pair)) idx.failedMessage.set(pair, r.message);
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
  /** For a bug confirmed still failing: what the check reported THIS run — the dated proof. */
  evidence?: string;
}

/**
 * The UI counterpart of `RunIndex`, keyed on the originating test title. A platform-wide UI ticket
 * (no single originating test) is not verified this way.
 */
export interface UiRunIndex {
  /** Test titles that ran and did NOT pass cleanly this run (failed, or flaky across retries). */
  failedTitle: Set<string>;
  /** Test titles that ran at all this run (passed, failed, or flaky — not skipped). */
  ranTitle: Set<string>;
  /** Per browser project: titles that ran / did not pass cleanly — for browser-tagged bugs. */
  ranBy: Map<string, Set<string>>;
  failedBy: Map<string, Set<string>>;
  /** `project::title` → this run's failure message, to tell WHICH problem made the test fail. */
  failedMessage: Map<string, string>;
}

export interface UiTestOutcome {
  title: string;
  /** Playwright's `TestCase.outcome()`: 'skipped' | 'expected' | 'unexpected' | 'flaky'. */
  outcome: string;
  /** Browser project (chromium / firefox / webkit / admin-ui). */
  project?: string;
  /** The failure message of the last failed attempt, when it failed. */
  message?: string;
}

export function buildUiRunIndex(records: readonly UiTestOutcome[]): UiRunIndex {
  const idx: UiRunIndex = {
    failedTitle: new Set(),
    ranTitle: new Set(),
    ranBy: new Map(),
    failedBy: new Map(),
    failedMessage: new Map(),
  };
  const add = (map: Map<string, Set<string>>, project: string, title: string): void => {
    map.set(project, (map.get(project) ?? new Set()).add(title));
  };
  for (const r of records) {
    if (r.outcome === 'skipped') continue; // a skipped test verified nothing
    idx.ranTitle.add(r.title);
    if (r.project) add(idx.ranBy, r.project, r.title);
    // 'flaky' is not a clean pass: a flake is not proof of a fix.
    if (r.outcome !== 'expected') {
      idx.failedTitle.add(r.title);
      if (r.project) add(idx.failedBy, r.project, r.title);
      if (r.project && r.message) idx.failedMessage.set(`${r.project}::${r.title}`, r.message);
    }
  }
  return idx;
}

/**
 * The test projects that re-check a UI bug, from its `[browser:…]` whiteboard tag (Admin UI's
 * `chromium` is `admin-ui`).
 */
function bugBrowsers(bug: BugSummary): string[] {
  const m = (bug.whiteboard ?? '').match(/\[browser:([^\]]+)\]/i);
  return m?.[1]
    ? m[1]
        .split(',')
        .map((b) => projectForBrowser(bug.product, b.trim().toLowerCase()))
        .filter(Boolean)
    : [];
}

/** Whether a bug summary (tag stripped, maybe truncated with `…`) belongs to this test title. */
export function uiTitleMatches(wantedFromSummary: string, actualTestTitle: string): boolean {
  // A UI summary is `<test title>: <error line>`, so the title is a prefix followed by ": ".
  const base = wantedFromSummary.endsWith('…') ? wantedFromSummary.slice(0, -1) : wantedFromSummary;
  if (base === actualTestTitle || base.startsWith(`${actualTestTitle}: `)) return true;
  // Summary truncated inside the title itself (a very long test name).
  return wantedFromSummary.endsWith('…') && actualTestTitle.startsWith(base);
}

/**
 * The kinds of problem a UI failure message reports, so a bug matches its own problem rather than
 * any failure of the same multi-check test. Empty when there are no markers.
 */
export function uiProblemSignature(text: string): Set<string> {
  const sig = new Set<string>();
  for (const m of text.matchAll(/\[(ui\.[a-z-]+)\]/gi)) sig.add(m[1]!.toLowerCase());
  if (/JS error|Uncaught|TypeError|ReferenceError|SyntaxError|React error/i.test(text))
    sig.add('js-error');
  for (const m of text.matchAll(/broken resource (\d{3})/gi)) sig.add(`resource-${m[1]}`);
  if (/froze|freez|unresponsive|blocked the main thread/i.test(text)) sig.add('freeze');
  if (/crashed when the network/i.test(text)) sig.add('offline-crash');
  if (/logs? (the user )?out|session (ended|expired)/i.test(text)) sig.add('logout');
  return sig;
}

function failureMessageFor(index: UiRunIndex, browser: string, title: string): string {
  for (const [key, message] of index.failedMessage) {
    const split = key.indexOf('::');
    if (key.slice(0, split) === browser && uiTitleMatches(title, key.slice(split + 2)))
      return message;
  }
  return '';
}

/** The UI counterpart of `classifyResolve`, keyed on the originating test's title, not an endpoint. */
export function classifyUiResolve(
  bug: BugSummary,
  index: UiRunIndex,
  reproducedTags: ReadonlySet<string>,
): ResolveDecision {
  const tag = bug.summary.match(/\[([A-Z]+-[0-9A-F]{6})\]/i)?.[1];
  if (tag && reproducedTags.has(tag)) {
    return { action: 'keep', reason: 'reproduced this run', validator: 'ui', systemic: false };
  }

  const title = bug.summary.replace(/^\[[^\]]+]\s*/, '').trim();
  if (!title) {
    return {
      action: 'keep',
      reason: 'could not match a single originating test (no title in the summary)',
      validator: 'ui',
      systemic: false,
    };
  }

  // A browser-tagged bug is verified only on its own browsers, and must be clean on all of them.
  const browsers = bugBrowsers(bug);
  if (browsers.length) {
    for (const browser of browsers) {
      const ranHere = [...(index.ranBy.get(browser) ?? [])].some((t) => uiTitleMatches(title, t));
      // The browser DID run this pass, yet no test matches the title — a many-screen ticket (platform-wide
      // crash, one WCAG rule across screens), not "this browser was not tested".
      if (
        !ranHere &&
        index.ranBy.has(browser) &&
        ![...index.ranTitle].some((t) => uiTitleMatches(title, t))
      ) {
        return {
          action: 'keep',
          reason: 'could not match a single originating test (it covers many screens)',
          validator: 'ui',
          systemic: false,
        };
      }
      if (!ranHere) {
        return {
          action: 'keep',
          reason: `its originating test did not run on ${browser} this pass`,
          validator: 'ui',
          systemic: false,
        };
      }
    }
    const failingOn = browsers.filter((browser) =>
      [...(index.failedBy.get(browser) ?? [])].some((t) => uiTitleMatches(title, t)),
    );
    if (failingOn.length) {
      // A multi-check test can fail for another reason: broken only if this bug's problem shows.
      const own = uiProblemSignature(title.replace(/^[^:]*:\s*/, ''));
      const reproducedOn = own.size
        ? failingOn.filter((browser) => {
            const now = uiProblemSignature(failureMessageFor(index, browser, title));
            return [...own].some((s) => now.has(s));
          })
        : failingOn;
      if (reproducedOn.length) {
        return {
          action: 'keep',
          reason: `its originating test ran again this pass and still failed (or was flaky) on ${reproducedOn.join(', ')}`,
          validator: 'ui',
          systemic: false,
        };
      }
      return {
        action: 'keep',
        reason: `its originating test failed for a different reason this pass on ${failingOn.join(', ')} — this bug's own problem (${[...own].join(', ')}) did not appear`,
        validator: 'ui',
        systemic: false,
      };
    }
    return {
      action: 'resolve',
      reason: `its originating test ran again this pass and passed cleanly on ${browsers.join(', ')}`,
      validator: 'ui',
      systemic: false,
    };
  }

  const ran = [...index.ranTitle].find((t) => uiTitleMatches(title, t));
  if (!ran) {
    return {
      action: 'keep',
      reason: `its originating test did not run this pass: "${title.slice(0, 70)}"`,
      validator: 'ui',
      systemic: false,
    };
  }
  const stillFailing = [...index.failedTitle].some((t) => uiTitleMatches(title, t));
  if (stillFailing) {
    return {
      action: 'keep',
      reason: 'its originating test ran again this pass and still failed (or was flaky)',
      validator: 'ui',
      systemic: false,
    };
  }
  return {
    action: 'resolve',
    reason: 'its originating test ran again this pass and passed cleanly',
    validator: 'ui',
    systemic: false,
  };
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
 * Whether one open bench bug was verified fixed: its own (endpoint, validator) ran and passed. A
 * systemic bug is checked against the endpoints it lists, falling back to "fails nowhere" when
 * those are unknown.
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
          evidence: index.failedMessage.get(`${stillFailing[0]}||${validator}`),
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
      evidence: index.failedMessage.get(pair),
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
