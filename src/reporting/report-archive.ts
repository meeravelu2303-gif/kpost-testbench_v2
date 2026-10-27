import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

/** How many earlier runs `reports/history/` keeps. Bugzilla is the permanent record, not this folder. */
export const REPORT_HISTORY_KEEP = 10;

/**
 * Moves the previous run's `REPORT.json` / `REPORT.md` into `reports/history/` before a new run
 * overwrites them, then drops all but the newest `keep` runs.
 *
 * Every run writes the same two files, so a `product:all` run used to keep only its last product's
 * report, and the manual `REPORT-before-*` backups piled up without limit. The history name carries
 * the product (`BENCH_PRODUCT`, set by each `product:*` command) so a reader can tell the runs apart.
 */
export function archivePreviousReport(
  dir: string,
  label = process.env.BENCH_PRODUCT ?? 'run',
  keep = REPORT_HISTORY_KEEP,
  now = new Date(),
): void {
  const history = path.join(dir, 'history');
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeLabel = label.replace(/[^\w-]/g, '_');
  let moved = false;
  for (const ext of ['json', 'md']) {
    const current = path.join(dir, `REPORT.${ext}`);
    if (!existsSync(current)) continue;
    mkdirSync(history, { recursive: true });
    renameSync(current, path.join(history, `${stamp}-${safeLabel}.${ext}`));
    moved = true;
  }
  if (moved || existsSync(history)) pruneHistory(history, keep);
}

/** Keeps the newest `keep` runs (a run = its .json + .md pair, which share a name). */
function pruneHistory(history: string, keep: number): void {
  const runs = [...new Set(readdirSync(history).map((file) => file.replace(/\.(json|md)$/, '')))]
    .sort()
    .reverse();
  for (const run of runs.slice(keep))
    for (const ext of ['json', 'md']) rmSync(path.join(history, `${run}.${ext}`), { force: true });
}
