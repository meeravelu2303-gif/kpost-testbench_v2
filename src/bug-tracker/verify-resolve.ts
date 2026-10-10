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
  /*
   * The hand-written admin write-fuzz checks (write-fuzz-workflow.spec.ts) record violations under
   * a ruleId that is ALREADY a precise, per-check identifier — e.g. "ADMIN-WRITE-FUZZ-admin-hr-tier-
   * attribute-save" or "ADMIN-WRITE-FUZZ-XSS-INJECTION-admin-employee-save". That exact string also
   * appears verbatim in the filed bug's own summary. Used as the class directly (not collapsed into
   * one generic bucket), so a "missing field" violation and an "XSS" violation on the SAME endpoint
   * stay distinguishable — confusing them would let one's pass wrongly auto-resolve the other.
   * Found 2026-10-01: before this, every one of these fell through to 'other' (NON_VERIFIABLE),
   * so these bugs could only ever be re-verified by an exact tag match, never by this (endpoint,
   * validator) check — 17 open tickets sat unverified every run regardless of whether their own
   * check had actually re-run, purely because of this classification gap.
   */
  const writeFuzzRule = t.match(/admin-write-fuzz-[a-z0-9-]+/);
  if (writeFuzzRule) return `business-rule.${writeFuzzRule[0]}`;
  /*
   * `flowFindingReports` (flow-finding.ts) records a lifecycle write-flow crash under the FIXED
   * validator name `flow.server-error`, with message text "write flow received HTTP {status} — a
   * server error where a 4xx (or success) belongs ... never crash the server." Must map to that
   * EXACT class, not the generic `response.status-code` catch-all below — they are different live
   * validators, and conflating them would make this check pass on an unrelated status-code success
   * rather than on this ticket's own flow-crash check actually re-running clean.
   */
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

/**
 * A FAILED result whose only evidence is that the server never answered (timeout, dropped socket,
 * disposed request context, throttling). It proves neither "fixed" nor "still broken" — the same rule
 * the validity gate applies before filing. Without this, a run against a hung or throttled host would
 * mark every bug "confirmed still failing" and tell developers so in a dated comment — a false claim.
 */
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
        // A multi-case check can mix one timed-out case with genuine "expected 400, got 200" ones —
        // that is still real evidence, so only a failure with NO real HTTP answer in it is discarded.
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
 * The UI-side counterpart of `RunIndex` — same safety rule (resolve only what genuinely ran clean
 * this pass), applied where there is no endpoint/validator pair: a UI finding's identity is the
 * Playwright test that produced it.
 *
 * Added 2026-10-07: before this, no mechanism checked open UI bugs against anything at all — a UI
 * run's auto-resolve pass always reported "checked 0 bugs", so a UI ticket only ever got touched
 * when its exact scenario happened to rerun AND its fingerprint still matched (see the
 * `feedback_ui_bugs_no_auto_verify_mechanism` incident). This closes that gap for the common case:
 * one ticket, one originating test. A platform-wide UI ticket (no single originating test) is not
 * covered yet — it falls through to `'could not match a single originating test'`, same as before.
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
    // 'flaky' (failed at least once, then passed on retry) is treated as NOT a clean pass — the
    // same caution this bench applies elsewhere to an intermittent reproduction: a flake is not
    // proof of a fix, it is proof the fault is inconsistent.
    if (r.outcome !== 'expected') {
      idx.failedTitle.add(r.title);
      if (r.project) add(idx.failedBy, r.project, r.title);
      if (r.project && r.message) idx.failedMessage.set(`${r.project}::${r.title}`, r.message);
    }
  }
  return idx;
}

/** The browsers a UI bug was filed for, from its whiteboard `[browser:chromium,firefox]` tag. */
function bugBrowsers(bug: BugSummary): string[] {
  const m = (bug.whiteboard ?? '').match(/\[browser:([^\]]+)\]/i);
  return m?.[1]
    ? m[1]
        .split(',')
        .map((b) => b.trim().toLowerCase())
        .filter(Boolean)
    : [];
}

/**
 * A bug's summary is `[TAG] <original test title>`, truncated with a trailing `…` when the title
 * was over Bugzilla's 255-character summary column (`buildSummary`). An exact match is used when
 * the title fit whole; a prefix match otherwise — matching how it was truncated, not guessing.
 */
export function uiTitleMatches(wantedFromSummary: string, actualTestTitle: string): boolean {
  // A filed UI bug's summary is `<test title>: <first line of the error>` (`candidateFromUiFailure`),
  // not the bare title — so the test is a PREFIX of the summary, followed by ": ". Until 2026-10-08
  // only an exact match was accepted, which matched 0 of 24 open chromium bugs: every one read as
  // "its test did not run" even when it had just run.
  const base = wantedFromSummary.endsWith('…') ? wantedFromSummary.slice(0, -1) : wantedFromSummary;
  if (base === actualTestTitle || base.startsWith(`${actualTestTitle}: `)) return true;
  // Summary truncated inside the title itself (a very long test name).
  return wantedFromSummary.endsWith('…') && actualTestTitle.startsWith(base);
}

/**
 * The KINDS of problem a UI failure message reports — layout, broken images, slow render, a JS error,
 * a resource failing with a given status, a freeze, a crash when offline — so a bug can be matched to
 * its own problem rather than to any failure of the same multi-check test. Empty when the message
 * carries none of these markers (then any failure of the test still counts, as before).
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

  /*
   * A bug tagged with its browsers is verified on THOSE browsers only, and closed only when its test
   * ran and passed cleanly on every one of them. Without this, a chromium-only run would close a
   * Firefox-only bug (e.g. #980) just because the same test passes on chromium.
   */
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
      /*
       * One screen test checks several things (layout, images, speed, crashes…), so it can fail for a
       * reason that has nothing to do with THIS bug. Only call the bug "still broken" when its OWN
       * problem shows up in this run's failure (2026-10-09: #1104, a layout-overflow bug, was marked
       * still broken although its test failed only on render speed and news images).
       */
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
