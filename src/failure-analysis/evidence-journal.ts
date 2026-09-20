import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { serialiseEvidence, type ExchangeEvidence } from './evidence';

/**
 * Where evidence is persisted: an append-only JSONL file, one exchange per line.
 *
 * The shape follows `FileResourceJournal` (Phase 2.4) deliberately — the repository already has one
 * durable-artifact pattern and a second would be a second thing to learn. One object per line means
 * a line is readable alone and a crash damages at most the last one.
 *
 * ## The one way it differs, and why
 *
 * `FileResourceJournal.append` THROWS when it cannot write, because losing a resource record means
 * losing track of something real on a live host — that must stop the run. Evidence is the opposite:
 * it is observational, it decides nothing, and a disk problem while recording it must never turn a
 * passing test red or a passing exchange into a defect. So this sink **never throws**. It counts its
 * failures and keeps the first few messages, and the reporter surfaces them — a silent evidence gap
 * would be worse than a loud one, and a failed run worse still.
 */

/** `reports/` is git-ignored, so a run's evidence is never committed. */
export const DEFAULT_EVIDENCE_FILE = 'reports/evidence.jsonl';

/** How many distinct failure messages to keep. Enough to diagnose; bounded so it cannot grow. */
const MAX_REMEMBERED_ERRORS = 5;

export interface EvidenceSink {
  append(evidence: ExchangeEvidence): void;
  /** Failures encountered while persisting. Empty when everything was written. */
  readonly errors: readonly string[];
  /** Total append attempts that failed, even beyond the remembered ones. */
  readonly failed: number;
  readonly written: number;
}

export class FileEvidenceJournal implements EvidenceSink {
  private readonly seen: string[] = [];
  private failures = 0;
  private count = 0;

  constructor(private readonly file: string) {}

  append(evidence: ExchangeEvidence): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${serialiseEvidence(evidence)}\n`, 'utf8');
      this.count += 1;
    } catch (error) {
      this.failures += 1;
      const message = `${evidence.endpointId}/${evidence.label}: ${(error as Error).message}`;
      if (this.seen.length < MAX_REMEMBERED_ERRORS) this.seen.push(message);
    }
  }

  get errors(): readonly string[] {
    return this.seen;
  }

  get failed(): number {
    return this.failures;
  }

  get written(): number {
    return this.count;
  }
}

/** A sink that keeps everything in memory — for tests, and for a run that persists nothing. */
export class MemoryEvidenceJournal implements EvidenceSink {
  readonly records: ExchangeEvidence[] = [];
  readonly errors: readonly string[] = [];
  readonly failed = 0;

  append(evidence: ExchangeEvidence): void {
    this.records.push(evidence);
  }

  get written(): number {
    return this.records.length;
  }
}
