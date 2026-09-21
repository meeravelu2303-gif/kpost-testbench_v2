import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isTestAccountStatus, type TestAccountRecord } from './account-record';
import type { AccountStore } from './account-registry';

/**
 * The durable account file — append-only, one JSON object per line.
 *
 * ## Why JSONL rather than a rewritten accounts.json
 *
 * This is the same decision the resource journal already made here, for the same reasons, and it is
 * the direct answer to "do not read-modify-write a JSON document":
 *
 *  - **Crash safety.** Rewriting one document means a process killed mid-write loses the WHOLE
 *    history. With one object per line a crash can damage at most the final line, and every earlier
 *    line stays readable.
 *  - **Concurrency.** A read-modify-write cycle from two workers loses whichever write lands first.
 *    An append does not have that shape at all.
 *  - **History.** Each line is a state the account was in, so "when did this become RETIRED" is
 *    answerable. A rewritten document only ever shows the present.
 *
 * The reader folds the lines into current state, last-write-wins per account — exactly how
 * `ResourceJournal` reconstructs a resource.
 *
 * ## Concurrency, stated honestly rather than implied
 *
 * Appends are single-process, line-buffered `appendFileSync` calls. On POSIX, appends below
 * `PIPE_BUF` to a file opened `O_APPEND` are atomic in practice; **Windows offers no such guarantee**
 * — and this bench runs on Windows — and neither platform makes it safe across machines or a network
 * share. Today `WORKERS=1`, so nothing contends and the constraint is theoretical.
 *
 * When parallel workers arrive, each slot should write `accounts.<slot>.jsonl` and the reader should
 * merge them. The reader below already accepts events from several sources in any order, so that
 * needs no redesign — only a file name. That is deliberately the SAME migration path the resource
 * journal documents, so the two stay consistent.
 *
 * ## Replaceable
 *
 * `AccountStore` is a two-method interface. Swapping this file for a database later changes nothing
 * in the registry and nothing in any signup flow.
 */

export class AccountStoreError extends Error {
  override readonly name = 'AccountStoreError';
}

/** A line that could not be read, with its number — surfaced, never silently skipped. */
export interface AccountStoreProblem {
  line: number;
  reason: string;
}

/** Parses the file's text. Pure, so the reader is testable without touching a disk. */
export function parseAccountLines(text: string): {
  records: TestAccountRecord[];
  problems: AccountStoreProblem[];
} {
  const records: TestAccountRecord[] = [];
  const problems: AccountStoreProblem[] = [];
  const lines = text.split('\n');

  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const lineNumber = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      /*
       * A truncated FINAL line is the expected crash signature, not corruption — the process died
       * mid-append. Reported as such rather than thrown, so one bad line never makes the whole
       * registry unreadable.
       */
      problems.push({
        line: lineNumber,
        reason:
          index === lines.length - 1
            ? 'malformed final line — the expected signature of a process killed mid-append'
            : 'malformed JSON',
      });
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      problems.push({ line: lineNumber, reason: 'not a JSON object' });
      return;
    }
    const candidate = parsed as Partial<TestAccountRecord>;
    if (typeof candidate.accountId !== 'string' || typeof candidate.kpostId !== 'string') {
      problems.push({ line: lineNumber, reason: 'missing accountId or kpostId' });
      return;
    }
    if (typeof candidate.environment !== 'string') {
      problems.push({ line: lineNumber, reason: 'missing environment' });
      return;
    }
    if (!isTestAccountStatus(candidate.status)) {
      problems.push({ line: lineNumber, reason: `unknown status ${String(candidate.status)}` });
      return;
    }
    records.push(candidate as TestAccountRecord);
  });

  return { records, problems };
}

export class JsonlAccountStore implements AccountStore {
  private readonly problemsSeen: AccountStoreProblem[] = [];

  constructor(readonly file: string) {}

  load(): TestAccountRecord[] {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      // No file yet is the normal first-run case, not an error.
      return [];
    }
    const { records, problems } = parseAccountLines(text);
    this.problemsSeen.splice(0, this.problemsSeen.length, ...problems);
    // Fold: the last line for an account is its current state.
    const folded = new Map<string, TestAccountRecord>();
    for (const record of records) folded.set(record.accountId, record);
    return [...folded.values()];
  }

  /** Problems found by the last `load()`. Visible so a damaged line is never silently dropped. */
  problems(): readonly AccountStoreProblem[] {
    return [...this.problemsSeen];
  }

  append(record: TestAccountRecord): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (error) {
      throw new AccountStoreError(
        `could not append to the account registry at ${this.file}: ${(error as Error).message}`,
      );
    }
  }
}
