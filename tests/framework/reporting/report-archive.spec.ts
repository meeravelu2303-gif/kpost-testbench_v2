import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@fixtures';
import { archivePreviousReport } from '@reporting/report-archive';

/**
 * Every run writes the same `reports/REPORT.*`; the previous one moves to `reports/history/`, named
 * after its OWN product and time (read from its REPORT.json), and only the newest runs are kept.
 */
test.describe('report archive', () => {
  let dir: string;

  test.beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'report-archive-'));
  });

  test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (product: string, generatedAt: string) => {
    writeFileSync(
      path.join(dir, 'REPORT.json'),
      JSON.stringify({ product, meta: { generatedAt } }),
    );
    writeFileSync(path.join(dir, 'REPORT.md'), `${product} report`);
  };

  test('names the previous report after its own product and run time', () => {
    write('kmail-api', '2026-10-27T09:15:00.000Z');
    archivePreviousReport(dir, { now: new Date('2026-10-27T10:00:00Z') });

    expect(existsSync(path.join(dir, 'REPORT.json'))).toBe(false);
    const history = readdirSync(path.join(dir, 'history')).sort();
    expect(history).toEqual([
      '2026-10-27T09-15-00-kmail-api.json',
      '2026-10-27T09-15-00-kmail-api.md',
    ]);
    expect(readFileSync(path.join(dir, 'history', history[1]!), 'utf8')).toBe('kmail-api report');
  });

  test('a report without a product name is archived as "run"', () => {
    writeFileSync(path.join(dir, 'REPORT.json'), '{}');
    archivePreviousReport(dir, { now: new Date('2026-10-27T10:00:00Z') });
    expect(readdirSync(path.join(dir, 'history'))).toEqual(['2026-10-27T10-00-00-run.json']);
  });

  test('keeps only the newest runs', () => {
    for (let hour = 10; hour < 15; hour++) {
      write('kpost-api', `2026-10-27T${hour}:00:00.000Z`);
      archivePreviousReport(dir, { keep: 3 });
    }
    const runs = [...new Set(readdirSync(path.join(dir, 'history')).map((f) => f.slice(0, 19)))];
    expect(runs.sort()).toEqual([
      '2026-10-27T12-00-00',
      '2026-10-27T13-00-00',
      '2026-10-27T14-00-00',
    ]);
  });

  test('does nothing on the first run, when there is no previous report', () => {
    archivePreviousReport(dir);
    expect(existsSync(path.join(dir, 'history'))).toBe(false);
  });
});
