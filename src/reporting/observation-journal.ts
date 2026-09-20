import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Observation } from '../failure-analysis/observation';

/**
 * Where classified failures are persisted: append-only JSONL, one observation per line.
 *
 * The same shape and the same failure policy as the evidence journal, and for the same reason: a
 * classification is observational, so a disk problem while recording one must never turn a passing
 * test red or change what the run concluded. Failures are counted and surfaced, never thrown.
 */

/** `reports/` is git-ignored, so a run's observations are never committed. */
export const DEFAULT_OBSERVATION_FILE = 'reports/observations.jsonl';

const MAX_REMEMBERED_ERRORS = 5;

export interface ObservationSink {
  append(observation: Observation): void;
  readonly errors: readonly string[];
  readonly failed: number;
  readonly written: number;
}

export class FileObservationJournal implements ObservationSink {
  private readonly seen: string[] = [];
  private failures = 0;
  private count = 0;

  constructor(private readonly file: string) {}

  append(observation: Observation): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(observation)}\n`, 'utf8');
      this.count += 1;
    } catch (error) {
      this.failures += 1;
      const message = `${observation.endpointId}/${observation.validatorName}: ${(error as Error).message}`;
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
export class MemoryObservationJournal implements ObservationSink {
  readonly records: Observation[] = [];
  readonly errors: readonly string[] = [];
  readonly failed = 0;

  append(observation: Observation): void {
    this.records.push(observation);
  }

  get written(): number {
    return this.records.length;
  }
}
