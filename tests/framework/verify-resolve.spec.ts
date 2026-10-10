import type { BugSummary } from '../../src/bug-tracker/bugzilla-client';
import {
  buildRunIndex,
  buildUiRunIndex,
  classifyResolve,
  classifyUiResolve,
  parseAffectedEndpoints,
} from '../../src/bug-tracker/verify-resolve';
import type {
  ValidationReport,
  ValidationResult,
} from '../../src/validation-engine/validation-result';
import { expect, test } from '@fixtures';

/**
 * Auto-resolve must only close a bug it PROVED fixed — its exact (endpoint, validator) ran and
 * passed this run. These pin that: still-failing, not-tested, and environmental checks stay open,
 * and a systemic class is only cleared when it no longer fails anywhere.
 */

function result(endpoint: string, validator: string, status: string): ValidationResult {
  return {
    validationId: 'v',
    validatorName: validator,
    category: 'RESPONSE',
    endpointId: endpoint,
    endpoint,
    method: 'POST',
    expected: null,
    actual: null,
    status,
    message: '',
    durationMs: 1,
    timestamp: new Date().toISOString(),
    severity: 'HIGH',
    correlationId: 'c',
  } as unknown as ValidationResult;
}

function report(results: ValidationResult[]): ValidationReport {
  return { suite: 'kpost-api', results } as unknown as ValidationReport;
}

function bug(summary: string): BugSummary {
  return { id: 1, summary, is_open: true, product: 'KPost API' };
}

const NONE = new Set<string>();

test.describe('auto-resolve verification', () => {
  test('closes an endpoint-specific bug whose check ran and passed @framework', () => {
    const index = buildRunIndex([
      report([result('POST /v2/common/domain/', 'request.null-value', 'PASSED')]),
    ]);
    const d = classifyResolve(
      bug(
        '[KP-AAA111] POST /v2/common/domain/: 1/1 negative request cases failed: body.x: null value',
      ),
      index,
      NONE,
    );
    expect(d.action).toBe('resolve');
  });

  test('keeps a bug whose check still fails @framework', () => {
    const index = buildRunIndex([
      report([result('POST /v2/common/domain/', 'request.null-value', 'FAILED')]),
    ]);
    const d = classifyResolve(
      bug('[KP-AAA111] POST /v2/common/domain/: body.x: null value (expected 400, got 200)'),
      index,
      NONE,
    );
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('still failing');
  });

  test('a still-failing bug carries what failed this run, as dated proof @framework', () => {
    const failed = {
      ...result('POST /v2/common/domain/', 'request.null-value', 'FAILED'),
      message:
        '1/1 negative request cases failed: body.x: null value (expected [400,422], got 500)',
    };
    const d = classifyResolve(
      bug('[KP-AAA111] POST /v2/common/domain/: body.x: null value (expected 400, got 200)'),
      buildRunIndex([report([failed])]),
      NONE,
    );
    expect(d.evidence).toContain('got 500');
  });

  test('a check that failed only because the server never answered is not "still failing" @framework', () => {
    const timedOut = {
      ...result('POST /v2/common/domain/', 'request.null-value', 'FAILED'),
      message: 'body.x: null value (apiRequestContext.fetch: Timeout 10000ms exceeded.)',
    };
    const d = classifyResolve(
      bug('[KP-AAA111] POST /v2/common/domain/: body.x: null value (expected 400, got 200)'),
      buildRunIndex([report([timedOut])]),
      NONE,
    );
    expect(d.action).toBe('keep');
    expect(d.reason).not.toContain('still failing');
  });

  test('a mixed check with one timeout but a real "got 200" is still evidence @framework', () => {
    const mixed = {
      ...result('POST /v2/common/domain/', 'request.null-value', 'FAILED'),
      message:
        'body.x: null value (expected [400,422], got 200); body.y (Timeout 10000ms exceeded.)',
    };
    const d = classifyResolve(
      bug('[KP-AAA111] POST /v2/common/domain/: body.x: null value (expected 400, got 200)'),
      buildRunIndex([report([mixed])]),
      NONE,
    );
    expect(d.reason).toContain('still failing');
  });

  test('keeps a bug whose endpoint was not tested this run @framework', () => {
    const index = buildRunIndex([
      report([result('POST /v2/other/endpoint', 'request.null-value', 'PASSED')]),
    ]);
    const d = classifyResolve(
      bug('[KP-AAA111] POST /v2/common/domain/: body.x: null value'),
      index,
      NONE,
    );
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('not tested');
  });

  test('keeps a bug when its validator was skipped (did not run) on the tested endpoint @framework', () => {
    // The endpoint ran a DIFFERENT validator; the bug's validator never executed → unverified.
    const index = buildRunIndex([
      report([result('POST /v2/common/domain/', 'response.status-code', 'PASSED')]),
    ]);
    const d = classifyResolve(
      bug('[KP-AAA111] POST /v2/common/domain/: body.x: null value'),
      index,
      NONE,
    );
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('did not run');
  });

  test('resolves a systemic bug only when the class no longer fails anywhere @framework', () => {
    const cleared = buildRunIndex([
      report([result('POST /a', 'security.security-headers', 'PASSED')]),
      report([result('POST /b', 'security.security-headers', 'PASSED')]),
    ]);
    const still = buildRunIndex([
      report([result('POST /a', 'security.security-headers', 'PASSED')]),
      report([result('POST /b', 'security.security-headers', 'FAILED')]),
    ]);
    const summary =
      '[KP-SYS001] Platform-wide — 6/6 security headers failed: content-security-policy';
    expect(classifyResolve(bug(summary), cleared, NONE).action).toBe('resolve');
    expect(classifyResolve(bug(summary), still, NONE).action).toBe('keep');
  });

  test('a systemic bug closes when ITS OWN endpoints pass, even if the class fails elsewhere @framework', () => {
    // getActiveSession + getLoginHistory now pass missing-token; the same class still fails on an
    // UNRELATED image endpoint. The ticket for the two session endpoints must still close.
    const index = buildRunIndex([
      report([
        result('GET /v2/signupLogin/getActiveSession', 'authentication.missing-token', 'PASSED'),
      ]),
      report([
        result('POST /v2/signupLogin/getLoginHistory', 'authentication.missing-token', 'PASSED'),
      ]),
      report([
        result('GET /v2/profile/downloadProfileImage', 'authentication.missing-token', 'FAILED'),
      ]),
    ]);
    const summary =
      '[KP-SES001] Platform-wide — missing-token cases failed: no Authorization header';
    const affected = [
      'GET /v2/signupLogin/getActiveSession',
      'POST /v2/signupLogin/getLoginHistory',
    ];
    expect(classifyResolve(bug(summary), index, NONE, affected).action, 'own endpoints fixed').toBe(
      'resolve',
    );
    // A ticket that IS the image endpoint stays open (its own endpoint still fails).
    const imgAffected = ['GET /v2/profile/downloadProfileImage'];
    expect(classifyResolve(bug(summary), index, NONE, imgAffected).action).toBe('keep');
  });

  test('parseAffectedEndpoints reads the description list and representative endpoint @framework', () => {
    const desc =
      'Representative endpoint: GET /v2/signupLogin/getActiveSession\n\n' +
      'Affects 2 endpoints — one shared fix resolves all of them:\n' +
      '  - GET /v2/signupLogin/getActiveSession\n' +
      '  - POST /v2/signupLogin/getLoginHistory\n';
    expect(parseAffectedEndpoints(desc).sort()).toEqual([
      'GET /v2/signupLogin/getActiveSession',
      'POST /v2/signupLogin/getLoginHistory',
    ]);
  });

  test('never auto-resolves an environmental (response-time) bug @framework', () => {
    const index = buildRunIndex([report([result('POST /v2/x', 'response.time', 'PASSED')])]);
    const d = classifyResolve(
      bug('[KP-AAA111] POST /v2/x: response time 1200ms exceeded budget'),
      index,
      NONE,
    );
    expect(d.action).toBe('keep');
  });

  test('keeps a bug that reproduced this run @framework', () => {
    const index = buildRunIndex([
      report([result('POST /v2/common/domain/', 'request.null-value', 'PASSED')]),
    ]);
    const d = classifyResolve(
      bug('[KP-AAA111] POST /v2/common/domain/: body.x: null value'),
      index,
      new Set(['KP-AAA111']),
    );
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('reproduced');
  });
});

/**
 * The UI counterpart — added 2026-10-07 to close the "UI bugs are never auto-verified" gap (see
 * `feedback_ui_bugs_no_auto_verify_mechanism`). A UI bug has no endpoint, so its identity for this
 * check is the originating Playwright test's title, embedded in the bug's own summary.
 */
function uiBug(summary: string): BugSummary {
  return { id: 2, summary, is_open: true, product: 'KPost UI' };
}

test.describe('auto-resolve verification — UI', () => {
  const T = 'Home — crawl every control @ui';
  const tagged = (browsers: string): BugSummary => ({
    ...uiBug(`[KP-AAA111] ${T}`),
    whiteboard: `[cat:Functional][browser:${browsers}]`,
  });

  test('a multi-check test failing for ANOTHER problem does not mark this bug still broken @framework', () => {
    const screen = 'Kall screen — controls, health, performance, responsive, a11y @ui';
    const layoutBug: BugSummary = {
      ...uiBug(
        `[KP-0F1104] ${screen}: Error: Kall UI issues — [ui.layout] Horizontal overflow at 1280px`,
      ),
      whiteboard: '[cat:Functional][browser:chromium]',
    };
    const otherReason = buildUiRunIndex([
      {
        title: screen,
        outcome: 'unexpected',
        project: 'chromium',
        message: 'Error: Kall UI issues — [ui.performance] The screen took 12174ms',
      },
    ]);
    const d = classifyUiResolve(layoutBug, otherReason, NONE);
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('different reason');
    expect(d.reason).not.toContain('still failed');

    const sameProblem = buildUiRunIndex([
      {
        title: screen,
        outcome: 'unexpected',
        project: 'chromium',
        message: 'Error: Kall UI issues — [ui.layout] Horizontal overflow at 1280px',
      },
    ]);
    expect(classifyUiResolve(layoutBug, sameProblem, NONE).reason).toContain('still failed');
  });

  test('a chromium-only run never closes a Firefox-only bug @framework', () => {
    const index = buildUiRunIndex([{ title: T, outcome: 'expected', project: 'chromium' }]);
    const d = classifyUiResolve(tagged('firefox'), index, NONE);
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('did not run on firefox');
  });

  test('a two-browser bug closes only when BOTH browsers ran and passed @framework', () => {
    const chromiumOnly = buildUiRunIndex([{ title: T, outcome: 'expected', project: 'chromium' }]);
    expect(classifyUiResolve(tagged('chromium,firefox'), chromiumOnly, NONE).action).toBe('keep');
    const both = buildUiRunIndex([
      { title: T, outcome: 'expected', project: 'chromium' },
      { title: T, outcome: 'expected', project: 'firefox' },
    ]);
    expect(classifyUiResolve(tagged('chromium,firefox'), both, NONE).action).toBe('resolve');
  });

  test('a bug still failing on its own browser stays open @framework', () => {
    const index = buildUiRunIndex([
      { title: T, outcome: 'expected', project: 'chromium' },
      { title: T, outcome: 'unexpected', project: 'firefox' },
    ]);
    const d = classifyUiResolve(tagged('firefox'), index, NONE);
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('still failed');
  });

  test('matches the REAL filed summary format "<test title>: <error>" to its test @framework', () => {
    // Exactly how candidateFromUiFailure titles a UI bug — the format that matched 0 of 24 before.
    const filed: BugSummary = {
      ...uiBug(`[KP-B9A1E4] ${T}: Error: Home broke while crawling its controls — broken resource`),
      whiteboard: '[cat:Functional][browser:chromium]',
    };
    const failed = buildUiRunIndex([{ title: T, outcome: 'unexpected', project: 'chromium' }]);
    expect(classifyUiResolve(filed, failed, NONE).reason).toContain('still failed');
    const passed = buildUiRunIndex([{ title: T, outcome: 'expected', project: 'chromium' }]);
    expect(classifyUiResolve(filed, passed, NONE).action).toBe('resolve');
  });

  test('a different test that merely shares a prefix is not a match @framework', () => {
    const filed: BugSummary = {
      ...uiBug(`[KP-B9A1E4] ${T} extended: Error: x`),
      whiteboard: '[browser:chromium]',
    };
    const index = buildUiRunIndex([{ title: T, outcome: 'expected', project: 'chromium' }]);
    expect(classifyUiResolve(filed, index, NONE).action).toBe('keep');
  });

  test('closes a UI bug whose originating test ran and passed cleanly @framework', () => {
    const index = buildUiRunIndex([
      { title: 'Home — crawl every control @ui', outcome: 'expected' },
    ]);
    const d = classifyUiResolve(uiBug('[KP-AAA111] Home — crawl every control @ui'), index, NONE);
    expect(d.action).toBe('resolve');
  });

  test('keeps a UI bug whose originating test still failed @framework', () => {
    const index = buildUiRunIndex([
      { title: 'Home — crawl every control @ui', outcome: 'unexpected' },
    ]);
    const d = classifyUiResolve(uiBug('[KP-AAA111] Home — crawl every control @ui'), index, NONE);
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('still failed');
  });

  test('keeps a UI bug whose originating test was flaky, not a clean pass @framework', () => {
    const index = buildUiRunIndex([{ title: 'Home — crawl every control @ui', outcome: 'flaky' }]);
    const d = classifyUiResolve(uiBug('[KP-AAA111] Home — crawl every control @ui'), index, NONE);
    expect(d.action).toBe('keep');
  });

  test('keeps a UI bug whose originating test did not run this pass @framework', () => {
    const index = buildUiRunIndex([
      { title: 'Katchup — crawl every control @ui', outcome: 'expected' },
    ]);
    const d = classifyUiResolve(uiBug('[KP-AAA111] Home — crawl every control @ui'), index, NONE);
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('did not run');
  });

  test('keeps a UI bug that reproduced this run @framework', () => {
    const index = buildUiRunIndex([
      { title: 'Home — crawl every control @ui', outcome: 'expected' },
    ]);
    const d = classifyUiResolve(
      uiBug('[KP-AAA111] Home — crawl every control @ui'),
      index,
      new Set(['KP-AAA111']),
    );
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('reproduced');
  });

  test('matches a truncated summary (ending in …) by prefix against the real test title @framework', () => {
    const longTitle =
      'KMail compose screen — controls, health, performance, responsive, a11y, and every other check @ui';
    const index = buildUiRunIndex([{ title: longTitle, outcome: 'expected' }]);
    const truncatedSummary = `[KP-AAA111] ${longTitle.slice(0, 50)}…`;
    const d = classifyUiResolve(uiBug(truncatedSummary), index, NONE);
    expect(d.action).toBe('resolve');
  });

  test('ignores a skipped test — it verifies nothing @framework', () => {
    const index = buildUiRunIndex([
      { title: 'Home — crawl every control @ui', outcome: 'skipped' },
    ]);
    const d = classifyUiResolve(uiBug('[KP-AAA111] Home — crawl every control @ui'), index, NONE);
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('did not run');
  });
});
