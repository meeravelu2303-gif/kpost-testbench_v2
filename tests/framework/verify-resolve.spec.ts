import type { BugSummary } from '../../src/bug-tracker/bugzilla-client';
import {
  buildRunIndex,
  classifyResolve,
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
