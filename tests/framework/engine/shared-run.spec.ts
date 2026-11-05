import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProductionSafetyError } from '@engine/production-guard';
import { sharedRun } from '@engine/shared-run';
import type { ValidationReport } from '@engine/validation-result';
import { expect, test } from '@fixtures';

/**
 * An endpoint's checks are reported from several type folders, but the engine must run it once per
 * run: the first caller runs it, every other caller (another file, another worker) reads that report.
 */
const report = (endpointId: string): ValidationReport =>
  ({
    endpointId,
    results: [],
    gate: { passed: true, blocking: [] },
  }) as unknown as ValidationReport;

test.describe('one engine run per endpoint, shared by every type folder @framework', () => {
  let dir: string;
  test.beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'shared-run-'));
  });
  test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('the second caller reads the first run instead of running the engine again', async () => {
    let runs = 0;
    const start = () => {
      runs += 1;
      return Promise.resolve(report('dashboard-home-msgs'));
    };
    const first = await sharedRun({ dir }, 'dashboard-home-msgs|FULL|retry-0', start);
    const second = await sharedRun({ dir }, 'dashboard-home-msgs|FULL|retry-0', start);
    expect(runs, 'the engine ran once').toBe(1);
    expect(second).toEqual(first);
  });

  test('callers that arrive together still share one run', async () => {
    let runs = 0;
    const start = async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return report('kall-get-log');
    };
    const all = await Promise.all(
      [1, 2, 3].map(() => sharedRun({ dir }, 'kall-get-log|FULL|retry-0', start)),
    );
    expect(runs, 'one run for three callers').toBe(1);
    expect(all.every((r) => (r as ValidationReport).endpointId === 'kall-get-log')).toBe(true);
  });

  test('a retry is a new key, so it runs the engine afresh', async () => {
    let runs = 0;
    const start = () => {
      runs += 1;
      return Promise.resolve(report('kall-get-log'));
    };
    await sharedRun({ dir }, 'kall-get-log|FULL|retry-0', start);
    await sharedRun({ dir }, 'kall-get-log|FULL|retry-1', start);
    expect(runs).toBe(2);
  });

  test('a production-guard refusal is shared as a refusal, not as a pass', async () => {
    const refuse = () => Promise.reject(new ProductionSafetyError('sends a real SMS'));
    const first = await sharedRun({ dir }, 'common-send-otp|FULL|retry-0', refuse);
    const second = await sharedRun({ dir }, 'common-send-otp|FULL|retry-0', refuse);
    expect(first).toBeInstanceOf(ProductionSafetyError);
    expect(second).toBeInstanceOf(ProductionSafetyError);
    expect((second as Error).message).toBe('sends a real SMS');
  });

  test('an engine crash fails every caller with the same error', async () => {
    const crash = () => Promise.reject(new Error('socket hang up'));
    await expect(sharedRun({ dir }, 'x|FULL|retry-0', crash)).rejects.toThrow(/socket hang up/);
    await expect(
      sharedRun({ dir }, 'x|FULL|retry-0', () => Promise.resolve(report('x'))),
    ).rejects.toThrow(/socket hang up/);
  });

  test('a lock left by a process that died is taken over, not waited on forever', async () => {
    // A pid far above any real one: no such process exists.
    writeFileSync(path.join(dir, 'y_FULL_retry-0.json.lock'), '999999999');
    const result = await sharedRun({ dir }, 'y|FULL|retry-0', () => Promise.resolve(report('y')));
    expect((result as ValidationReport).endpointId).toBe('y');
  });
});
