import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

/** How many earlier runs `reports/history/` keeps. Bugzilla is the permanent record, not this folder. */
export const REPORT_HISTORY_KEEP = 10;

/** The product and time a report belongs to, read from its own REPORT.json (written by writeRunReport). */
function reportIdentity(dir: string, now: Date): { product: string; at: string } {
  try {
    const json = JSON.parse(readFileSync(path.join(dir, 'REPORT.json'), 'utf8')) as {
      product?: string;
      meta?: { generatedAt?: string };
    };
    return { product: json.product ?? 'run', at: json.meta?.generatedAt ?? now.toISOString() };
  } catch {
    return { product: 'run', at: now.toISOString() };
  }
}

/**
 * Moves the previous `REPORT.json`/`.md` into `reports/history/` before a new run overwrites them,
 * named after that report's own product and time, keeping the newest `keep` runs.
 */
export function archivePreviousReport(
  dir: string,
  { keep = REPORT_HISTORY_KEEP, now = new Date() }: { keep?: number; now?: Date } = {},
): void {
  const history = path.join(dir, 'history');
  const { product, at } = reportIdentity(dir, now);
  const name = `${at.replace(/[:.]/g, '-').slice(0, 19)}-${product.replace(/[^\w-]/g, '_')}`;
  let moved = false;
  for (const ext of ['json', 'md']) {
    const current = path.join(dir, `REPORT.${ext}`);
    if (!existsSync(current)) continue;
    mkdirSync(history, { recursive: true });
    renameSync(current, path.join(history, `${name}.${ext}`));
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
