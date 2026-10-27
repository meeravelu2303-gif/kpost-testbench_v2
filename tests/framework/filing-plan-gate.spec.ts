import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readBugzillaConfig } from '../../src/config/bugzilla.config';
import {
  loadFilingPlan,
  markFilingPlanApplied,
  runFiling,
  saveFilingInput,
  type FilingInput,
} from '../../src/reporting/filing-run';
import { createLogger } from '../../src/utils/logger';
import { expect, test } from '@fixtures';

/**
 * `npm run bug:apply` files a preview run's findings later. These pin its gate: only an unapplied
 * preview that passed the run gate, under a day old, can be applied, and only once.
 */
test.describe('bug:apply plan gate @framework', () => {
  let dir: string;
  let file: string;
  const log = createLogger('test');
  const now = new Date('2026-10-27T12:00:00Z');
  const plan = (over: Partial<FilingInput> = {}): FilingInput => ({
    version: 1,
    checkedAt: '2026-10-27T10:00:00.000Z',
    product: 'kpost-api',
    environment: 'production',
    testRunId: 'run-test',
    build: 'local',
    runStatus: 'failed',
    dryRun: true,
    validity: { valid: true, reason: '' },
    candidates: [],
    validationReports: [],
    uiRecords: [],
    uiEnvironmentalOnly: [],
    uiProof: [],
    ...over,
  });
  const refusal = (input: FilingInput, at = now): string => {
    writeFileSync(file, JSON.stringify(input));
    const result = loadFilingPlan({ file, now: at });
    return 'refused' in result ? result.refused : '';
  };

  test.beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'filing-plan-'));
    file = path.join(dir, 'filing-input.json');
  });

  test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('a fresh, valid, unapplied preview is accepted', () => {
    expect(refusal(plan())).toBe('');
  });

  test('no preview yet: refused', () => {
    const result = loadFilingPlan({ file, now });
    expect('refused' in result && result.refused).toContain('run a product preview first');
  });

  test('a run that already filed (not a preview): refused', () => {
    expect(refusal(plan({ dryRun: false }))).toContain('not a preview');
  });

  test('a one-off run (no product command): refused', () => {
    expect(refusal(plan({ product: 'run' }))).toContain('not a product command');
  });

  test('a run that failed the run gate: refused', () => {
    expect(
      refusal(plan({ validity: { valid: false, reason: 'the run was interrupted' } })),
    ).toContain('failed the run gate');
  });

  test('a plan older than a day, or dated in the future: refused', () => {
    expect(refusal(plan(), new Date('2026-10-28T10:30:00Z'))).toContain('h old');
    expect(refusal(plan(), new Date('2026-10-27T09:00:00Z'))).toContain('h old');
  });

  test('a plan can be applied only once', () => {
    writeFileSync(file, JSON.stringify(plan()));
    markFilingPlanApplied(plan(), { file, at: now });
    const result = loadFilingPlan({ file, now });
    expect('refused' in result && result.refused).toContain('already applied');
  });

  test('the saved plan has credentials masked but keeps kpostIDs', () => {
    const token = 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJxYXRlc3QxQGtwb3N0aW5kaWEuY29tIn0.c2ln';
    saveFilingInput(
      plan({ testRunId: `Authorization: Bearer ${token} for qatest1@kpostindia.com` }),
      log,
      file,
    );
    const saved = readFileSync(file, 'utf8');
    expect(saved).not.toContain(token);
    expect(saved).toContain('qatest1@kpostindia.com');
  });

  test('a run that failed the run gate files nothing, even if loaded directly', async () => {
    const config = { ...readBugzillaConfig(), enabled: true, dryRun: true };
    const result = await runFiling(
      plan({ validity: { valid: false, reason: 'zero tests ran' } }),
      config,
      log,
    );
    expect(result.outcome).toBeUndefined();
    expect(result.notFiledReason).toContain('run gate blocked filing');
  });
});
