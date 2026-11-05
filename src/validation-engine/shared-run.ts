import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { ProductionSafetyError } from './production-guard';
import type { ValidationReport } from './validation-result';

/**
 * One engine run per endpoint, shared by every type folder that reports a slice of it.
 *
 * An endpoint's checks are reported from up to ten files (contract/, negative/, boundary/, …), and
 * Playwright may run those files in different worker processes, or in one worker that restarted after
 * a failure. The first file to reach an endpoint runs the engine and attaches the report (that is what
 * the Bugzilla filer reads); every other file reads the same report from disk. So the server sees each
 * endpoint's requests once per run, exactly as before the split, and the aggregate checks (error
 * format, information disclosure, sensitive data) still see every exchange of that run.
 *
 * The store lives in the run's output folder, keyed by TEST_RUN_ID (new for every Playwright
 * invocation), so a result never outlives its run. A retry gets its own key: it re-runs the engine.
 */

type Stored =
  | { kind: 'report'; report: ValidationReport }
  | { kind: 'safety'; message: string }
  | { kind: 'error'; message: string };

const POLL_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function read(file: string): Stored | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Stored;
  } catch {
    return undefined;
  }
}

function revive(stored: Stored): ValidationReport | ProductionSafetyError {
  if (stored.kind === 'report') return stored.report;
  if (stored.kind === 'safety') return new ProductionSafetyError(stored.message);
  throw new Error(`the engine run for this endpoint failed: ${stored.message}`);
}

/** True when the lock names a process that no longer exists (it was killed mid-run). */
function isStale(lock: string): boolean {
  try {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) return true;
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // ENOENT: the lock was just released, so try again. ESRCH: its owner is gone.
    return (error as NodeJS.ErrnoException).code !== 'EPERM';
  }
}

function tryLock(lock: string): boolean {
  try {
    const fd = openSync(lock, 'wx');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export interface SharedRunStore {
  /** The run's own folder (e.g. `test-results/.engine-runs/<TEST_RUN_ID>`). */
  dir: string;
}

/**
 * The report for `key`: read from the store when another file already ran it, otherwise produced by
 * `start()` (which attaches it to the current test) and stored for the rest.
 */
export async function sharedRun(
  store: SharedRunStore,
  key: string,
  start: () => Promise<ValidationReport>,
): Promise<ValidationReport | ProductionSafetyError> {
  mkdirSync(store.dir, { recursive: true });
  const file = path.join(store.dir, `${key.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`);
  const lock = `${file}.lock`;

  for (;;) {
    const done = read(file);
    if (done) return revive(done);

    if (tryLock(lock)) {
      try {
        // Another process may have finished between the read and the lock.
        const raced = read(file);
        if (raced) return revive(raced);

        let stored: Stored;
        try {
          stored = { kind: 'report', report: await start() };
        } catch (error) {
          stored =
            error instanceof ProductionSafetyError
              ? { kind: 'safety', message: error.message }
              : { kind: 'error', message: error instanceof Error ? error.message : String(error) };
        }
        // Write then rename, so a reader never sees half a file.
        writeFileSync(`${file}.tmp`, JSON.stringify(stored), 'utf8');
        renameSync(`${file}.tmp`, file);
        return revive(stored);
      } finally {
        rmSync(lock, { force: true });
      }
    }

    if (isStale(lock)) {
      rmSync(lock, { force: true });
      continue;
    }
    await sleep(POLL_MS);
  }
}
