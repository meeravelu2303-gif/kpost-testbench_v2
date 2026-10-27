import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@fixtures';
import { archivePreviousReport } from '@reporting/report-archive';

/**
 * Every run writes the same `reports/REPORT.*`. Before 2026-10-27 a `product:all` run kept only its last
 * product's report, and hand-made backups piled up without limit. These pin the fix: the previous report
 * moves to `reports/history/` under its product's name, and only the newest runs are kept.
 */
test.describe('report archive', () => {
  let dir: string;
  test.beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'report-archive-'));
  });
  test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (body: string) => {
    writeFileSync(path.join(dir, 'REPORT.json'), body);
    writeFileSync(path.join(dir, 'REPORT.md'), body);
  };

  test('moves the previous report into history, named after its product', () => {
    write('kpost run');
    archivePreviousReport(dir, 'kpost-api', 10, new Date('2026-10-27T10:00:00Z'));

    expect(existsSync(path.join(dir, 'REPORT.json'))).toBe(false);
    const history = readdirSync(path.join(dir, 'history')).sort();
    expect(history).toEqual([
      '2026-10-27T10-00-00-kpost-api.json',
      '2026-10-27T10-00-00-kpost-api.md',
    ]);
    expect(readFileSync(path.join(dir, 'history', history[0]!), 'utf8')).toBe('kpost run');
  });

  test('keeps only the newest runs', () => {
    for (let hour = 10; hour < 15; hour++) {
      write(`run ${hour}`);
      archivePreviousReport(dir, 'run', 3, new Date(`2026-10-27T${hour}:00:00Z`));
    }
    const runs = [...new Set(readdirSync(path.join(dir, 'history')).map((f) => f.slice(0, 19)))];
    expect(runs.sort()).toEqual([
      '2026-10-27T12-00-00',
      '2026-10-27T13-00-00',
      '2026-10-27T14-00-00',
    ]);
  });

  test('does nothing on the first run, when there is no previous report', () => {
    archivePreviousReport(dir, 'run');
    expect(existsSync(path.join(dir, 'history'))).toBe(false);
  });
});
