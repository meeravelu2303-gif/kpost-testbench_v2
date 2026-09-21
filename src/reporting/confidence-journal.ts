import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ConfidenceDecisionRecord } from '../failure-analysis/confidence';

/**
 * Where shadow confidence decisions are persisted: append-only JSONL, one decision per line.
 *
 * The same shape and the same failure policy as the evidence and observation journals, and for the
 * same reason: a shadow decision is observational, so a disk problem while recording one must never
 * turn a passing test red or change what the run concluded. Failures are counted and surfaced at the
 * end of the run, never thrown.
 *
 * One JSON object per line, carrying the whole record, so a line is readable on its own and a crash
 * damages at most the last one.
 */

/** `reports/` is git-ignored, so a run's shadow decisions are never committed. */
export const DEFAULT_CONFIDENCE_FILE = 'reports/confidence-decisions.jsonl';

/** Where the run-level comparison against the existing candidate pipeline is written. */
export const DEFAULT_DIVERGENCE_FILE = 'reports/confidence-divergence.json';

const MAX_REMEMBERED_ERRORS = 5;

export interface ConfidenceSink {
  append(decision: ConfidenceDecisionRecord): void;
  readonly errors: readonly string[];
  readonly failed: number;
  readonly written: number;
}

export class FileConfidenceJournal implements ConfidenceSink {
  private readonly seen: string[] = [];
  private failures = 0;
  private count = 0;

  constructor(private readonly file: string) {}

  append(decision: ConfidenceDecisionRecord): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(decision)}\n`, 'utf8');
      this.count += 1;
    } catch (error) {
      this.failures += 1;
      const message = `${decision.observationKey}: ${(error as Error).message}`;
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

/** In-memory sink, for tests and for a run that persists nothing. */
export class MemoryConfidenceJournal implements ConfidenceSink {
  readonly records: ConfidenceDecisionRecord[] = [];
  readonly errors: readonly string[] = [];
  readonly failed = 0;

  append(decision: ConfidenceDecisionRecord): void {
    this.records.push(decision);
  }

  get written(): number {
    return this.records.length;
  }
}
