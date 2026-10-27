import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BugSummary } from '../../src/bug-tracker/bugzilla-client';
import type { ResolveDecision } from '../../src/bug-tracker/verify-resolve';
import { readBugzillaConfig } from '../../src/config/bugzilla.config';
import {
  buildBugReportConsole,
  buildBugReportMarkdown,
  type ResolveSummary,
} from '../../src/reporting/bug-report';
import {
  HAND_FILED,
  handCheckReason,
  plainStatusComment,
  runFiling,
  type FilingInput,
} from '../../src/reporting/filing-run';
import { createLogger } from '../../src/utils/logger';
import type { ValidationReport } from '../../src/validation-engine/validation-result';
import { expect, test } from '@fixtures';

/**
 * Open bugs no run can close (hand-filed, speed, or no single check matches them) are listed as
 * RE-CHECK BY HAND in REPORT.md and `report:filing`, so none is forgotten. A bug whose check only
 * didn't run this time is not listed: a later run closes it.
 */
test.describe('re-check by hand list @framework', () => {
  const log = createLogger('test');
  const openBug = (
    id: number,
    summary: string,
    component = 'Group',
  ): BugSummary & { component: string } => ({
    id,
    summary,
    is_open: true,
    component,
    product: 'KPost API',
  });

  test('the status pass lists every open bug no run can close, and writes nothing on a preview', async () => {
    const bugs = [
      openBug(1, '[KP-GROUPADMINEXIT] POST /v2/group/leaveFromGroup/: a group admin cannot exit'),
      openBug(2, '[KP-A1B2C3] POST /v2/kall/kallDashboard: response time 4.2 s over the budget'),
      openBug(3, '[KP-B2C3D4] POST /v2/profile/getProfile: expected 400, got 500'),
      openBug(4, '[KP-C3D4E5] Katchup forwards lose the hidden flag'),
      openBug(5, '[KP-D4E5F6] expected 400, got 500 on several screens'),
      // KDoc/KWord is paused by owner order: found by its path, or by its component alone.
      openBug(6, '[KP-BAD011] GET /kword/documentsType: 13/24 ID checks failed'),
      openBug(
        7,
        '[KP-KWORDCREATEFAILS] Kompose: a new Word document always fails',
        'KWord Documents',
      ),
    ];
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${String(url).split('?')[0]}`);
      const body = method === 'GET' && String(url).includes('/bug?product=') ? { bugs } : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch;
    try {
      const input: FilingInput = {
        version: 1,
        checkedAt: '2026-10-27T10:00:00.000Z',
        product: 'kpost-api',
        environment: 'production',
        testRunId: 'run-test',
        build: 'local',
        runStatus: 'passed',
        dryRun: true,
        validity: { valid: true, reason: '' },
        candidates: [],
        validationReports: [{ suite: 'kpost-api', results: [] } as unknown as ValidationReport],
        uiRecords: [],
        uiEnvironmentalOnly: [],
        uiProof: [],
      };
      const config = {
        ...readBugzillaConfig(),
        enabled: true,
        dryRun: true,
        autoResolve: true,
        resolveOnly: false,
        url: 'http://bugzilla.invalid/rest',
        apiKey: 'test-key',
      };
      const result = await runFiling(input, config, log);

      expect(result.resolved?.byHand?.map((b) => [b.bugId, b.why])).toEqual([
        [1, 'filed by hand: no single automated check covers it'],
        [2, 'a speed bug: one fast run does not prove it fixed'],
        [4, 'its title does not say which check it is'],
        [5, 'its title does not name one endpoint or test the bench can re-run'],
      ]);
      expect(result.resolved?.byHand?.[0]).toMatchObject({
        product: 'KPost API',
        component: 'Group',
      });
      // #3's endpoint just didn't run this time; a later run closes it, so it is not listed.
      expect(result.resolved?.byHand?.some((b) => b.bugId === 3)).toBe(false);
      expect(calls.every((c) => c.startsWith('GET '))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('a bug still broken, or not run this time, is not listed', () => {
    const keep = (reason: string): ResolveDecision => ({
      action: 'keep',
      reason,
      validator: 'response.status-code',
      systemic: false,
    });
    expect(handCheckReason(keep('still failing on POST /V2/X'))).toBeUndefined();
    expect(handCheckReason(keep('reproduced this run'))).toBeUndefined();
    expect(handCheckReason(keep('endpoint not tested this run (POST /V2/X)'))).toBeUndefined();
    expect(
      handCheckReason(keep('its originating test did not run this pass: "x"')),
    ).toBeUndefined();
    expect(handCheckReason(keep(HAND_FILED))).toBeDefined();
  });

  test('a hand-filed KWord bug gets the "paused" note, not "re-check by hand"', () => {
    const comment = plainStatusComment(
      openBug(
        925,
        '[KP-KWORDCREATEFAILS] Kompose: a new Word document always fails',
        'KWord Documents',
      ),
      { action: 'keep', reason: HAND_FILED, validator: 'manual', systemic: false },
    );
    expect(comment).toContain('The KDoc module is paused from testing');
    expect(comment).not.toContain('re-run the steps in the bug description by hand');
  });

  const resolved: ResolveSummary = {
    resolved: [],
    keptOpen: 1,
    checked: 1,
    failed: 0,
    confirmedFailing: 0,
    notVerified: 1,
    touched: 1,
    dryRun: true,
    byHand: [
      {
        bugId: 1366,
        product: 'KPost API',
        component: 'Group',
        summary: '[KP-GROUPADMINEXIT] POST /v2/group/leaveFromGroup/: a group admin cannot exit',
        why: 'filed by hand: no single automated check covers it',
      },
    ],
  };

  test('REPORT.md and the console summary show the list', () => {
    const report = {
      environment: 'production',
      runStatus: 'passed',
      testRunId: 'run-test',
      build: 'local',
      generatedAt: '2026-10-27T10:00:00.000Z',
      validationReports: [],
      merged: [],
      rejected: [],
      resolved,
    };
    const md = buildBugReportMarkdown(report);
    expect(md).toContain('### Re-check by hand (1)');
    expect(md).toContain('| #1366 | Group | [KP-GROUPADMINEXIT] POST /v2/group/leaveFromGroup/');
    expect(buildBugReportConsole(report)).toContain('Re-check by hand: 1 open bug(s)');
  });

  test('report:filing prints the list, and stays quiet for a report written before it existed', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hand-check-'));
    try {
      const print = (bugsResolved: unknown, over: Record<string, unknown> = {}): string => {
        const file = path.join(dir, 'REPORT.json');
        const bugs = { filing: null, resolved: bugsResolved, notFiledReason: null };
        writeFileSync(file, JSON.stringify({ product: 'kpost-api', meta: {}, bugs, ...over }));
        return execFileSync(process.execPath, [path.join('scripts', 'filing-plan.cjs'), file], {
          encoding: 'utf8',
        });
      };
      const out = print(resolved);
      expect(out).toContain('RE-CHECK BY HAND — open bugs no run can close (1)');
      expect(out).toContain('#1366 (Group) [KP-GROUPADMINEXIT]');
      expect(out).toContain('why: filed by hand');
      expect(out).toContain('npm run bug:apply files this plan');

      const { byHand: _omitted, ...older } = resolved;
      expect(print(older)).not.toContain('RE-CHECK BY HAND');

      // It never points at bug:apply for a plan bug:apply will refuse.
      expect(print(resolved, { product: 'run' })).toContain('bug:apply will refuse it');
      const blocked = print(resolved, {
        bugs: { resolved, notFiledReason: 'run gate blocked filing — zero tests ran' },
      });
      expect(blocked).toContain('Nothing from this run can be filed');
      expect(blocked).not.toContain('bug:apply files this plan');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
