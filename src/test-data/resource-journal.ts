import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  canTransition,
  isResourceState,
  redactForJournal,
  resourceKey,
  type ResourceIdentity,
  type ResourceRecord,
  type ResourceState,
} from './resource-record';

/**
 * The durable, append-only record of everything the bench created.
 *
 * ## Why append-only, one line per event
 *
 * A single JSON document would have to be rewritten on every update: a process killed mid-write
 * leaves a truncated file and loses the WHOLE history, which is precisely the case the journal
 * exists for. One JSON object per line means a crash can damage at most the final line, and every
 * earlier event stays readable — so a later phase can still see what was created and never cleaned.
 *
 * ## Concurrency, stated honestly
 *
 * Appends are single-process, line-buffered writes (`appendFileSync` with `'a'`). On POSIX, writes
 * below `PIPE_BUF` to a file opened `O_APPEND` are atomic in practice; Windows offers no such
 * guarantee, and neither platform makes this safe across machines or a network share. The reader
 * therefore treats a malformed final line as an expected outcome rather than corruption.
 *
 * Today the bench runs one worker, so nothing contends. When parallel slots arrive, each slot should
 * write its own journal file (`resources.<slot>.jsonl`) and the reader should merge them — the
 * reader already accepts events from several sources in any order, so that needs no redesign here.
 *
 * ## What this file will NOT do
 *
 * It never deletes anything, never calls KPost, and never decides that a leftover resource is a
 * product defect. It is evidence for the later cleanup/recovery phase.
 */

export class ResourceJournalError extends Error {
  override readonly name = 'ResourceJournalError';
}

/** Why a record changed. `registered` is the first event; the rest are transitions. */
export type ResourceEventType = 'registered' | 'transition';

/**
 * One durable event. It carries the whole record, not a delta: a line must be readable on its own,
 * so a reader never has to resolve a chain of partial updates to know what a resource is.
 */
export interface ResourceEvent extends ResourceIdentity {
  event: ResourceEventType;
  eventAt: string;
  describe: string;
  registeredAt: string;
  state: ResourceState;
  cleanupResult: string | null;
}

/** Where events go. Injectable so tests never touch a developer's real `reports/`. */
export interface ResourceJournalSink {
  append(event: ResourceEvent): void;
}

/** Discards events — for a ledger used purely in-memory (unit tests, dry reasoning). */
export const NULL_JOURNAL_SINK: ResourceJournalSink = { append: () => undefined };

/** Appends to a JSON Lines file, creating the directory on first write. */
export class FileResourceJournal implements ResourceJournalSink {
  constructor(private readonly file: string) {}

  append(event: ResourceEvent): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(event)}\n`, 'utf8');
    } catch (error) {
      throw new ResourceJournalError(
        `could not append to the resource journal at ${this.file}: ${(error as Error).message}`,
      );
    }
  }
}

/** The default location. `reports/` is git-ignored, so a run's journal is never committed. */
export const DEFAULT_JOURNAL_FILE = 'reports/resources.jsonl';

/** A line the reader could not use. Surfaced, never silently dropped. */
export interface JournalIssue {
  /** 1-based line number in the journal. */
  line: number;
  reason:
    | 'malformed-json'
    | 'missing-fields'
    | 'unknown-state'
    | 'duplicate-registration'
    | 'invalid-transition'
    | 'transition-before-registration';
  detail: string;
  /** The raw line, truncated and masked — useful for a human, safe to print. */
  raw: string;
}

export interface JournalReadResult {
  /** Current state per resource, in first-seen order. */
  records: ResourceRecord[];
  issues: JournalIssue[];
  /** Events the reader accepted. */
  eventsRead: number;
  /** True when the final line was incomplete — the signature of a killed process. */
  truncatedFinalLine: boolean;
}

const MAX_RAW_CHARS = 200;

function requiredString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Rebuilds current resource state from a journal.
 *
 * Pure: it takes the journal's TEXT, so it can run against a file, a fixture, or a merged set of
 * per-slot journals without any I/O of its own. Corruption is reported rather than hidden — the
 * later recovery phase needs to know that a line was unreadable, because an unreadable line may be
 * the one resource nobody else knows about.
 */
export function readJournalText(text: string): JournalReadResult {
  const lines = text.split('\n');
  const endsWithNewline = text.endsWith('\n') || text.length === 0;
  const records = new Map<string, ResourceRecord>();
  const issues: JournalIssue[] = [];
  let eventsRead = 0;
  let truncatedFinalLine = false;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!line.trim()) return;

    const isFinalLine = index === lines.length - 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // A process killed mid-write damages at most the last line; that is expected, not corruption.
      if (isFinalLine && !endsWithNewline) {
        truncatedFinalLine = true;
        return;
      }
      issues.push({
        line: lineNumber,
        reason: 'malformed-json',
        detail: 'line is not valid JSON',
        raw: redactForJournal(line.slice(0, MAX_RAW_CHARS)),
      });
      return;
    }

    const event = parsed as Partial<ResourceEvent>;
    const runId = requiredString(event.runId);
    const testCaseId = requiredString(event.testCaseId);
    const kind = requiredString(event.kind);
    const id = requiredString(event.id);
    const registeredAt = requiredString(event.registeredAt);
    if (!runId || !testCaseId || !kind || !id || !registeredAt) {
      issues.push({
        line: lineNumber,
        reason: 'missing-fields',
        detail: 'runId, testCaseId, kind, id and registeredAt are all required',
        raw: redactForJournal(line.slice(0, MAX_RAW_CHARS)),
      });
      return;
    }
    if (!isResourceState(event.state)) {
      issues.push({
        line: lineNumber,
        reason: 'unknown-state',
        detail: `unknown resource state ${JSON.stringify(event.state)}`,
        raw: redactForJournal(line.slice(0, MAX_RAW_CHARS)),
      });
      return;
    }

    const slot = typeof event.slot === 'number' ? event.slot : null;
    const identity: ResourceIdentity = { runId, testCaseId, slot, kind, id };
    const key = resourceKey(identity);
    const existing = records.get(key);
    eventsRead += 1;

    if (event.event === 'registered') {
      if (existing) {
        // Two registrations of one identity: the ledger refuses this, so a journal containing it was
        // written by something that bypassed the ledger, or two processes shared an identity.
        issues.push({
          line: lineNumber,
          reason: 'duplicate-registration',
          detail: `resource already registered (${key})`,
          raw: redactForJournal(line.slice(0, MAX_RAW_CHARS)),
        });
        return;
      }
      records.set(key, {
        ...identity,
        describe: typeof event.describe === 'string' ? event.describe : '',
        registeredAt,
        state: event.state,
        cleanupResult: event.cleanupResult ?? null,
        updatedAt: null,
      });
      return;
    }

    if (!existing) {
      issues.push({
        line: lineNumber,
        reason: 'transition-before-registration',
        detail: `transition for an unregistered resource (${key})`,
        raw: redactForJournal(line.slice(0, MAX_RAW_CHARS)),
      });
      return;
    }
    if (!canTransition(existing.state, event.state)) {
      issues.push({
        line: lineNumber,
        reason: 'invalid-transition',
        detail: `${existing.state} → ${event.state} is not a legal transition (${key})`,
        raw: redactForJournal(line.slice(0, MAX_RAW_CHARS)),
      });
      return;
    }
    records.set(key, {
      ...existing,
      state: event.state,
      cleanupResult: event.cleanupResult ?? existing.cleanupResult,
      updatedAt: requiredString(event.eventAt) ?? existing.updatedAt,
    });
  });

  return { records: [...records.values()], issues, eventsRead, truncatedFinalLine };
}

/** Reads a journal file; a missing file is an empty journal, not an error. */
export function readJournalFile(file: string = DEFAULT_JOURNAL_FILE): JournalReadResult {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { records: [], issues: [], eventsRead: 0, truncatedFinalLine: false };
    }
    throw new ResourceJournalError(`could not read ${file}: ${(error as Error).message}`);
  }
  return readJournalText(text);
}

/**
 * What a later cleanup phase would have to look at. Purely descriptive:
 *
 * - `neverCleaned` — still `REGISTERED`: no cleanup was ever attempted (the crash signature)
 * - `pending`      — cleanup started and the process never recorded the outcome
 * - `failed`       — cleanup ran and the target refused
 *
 * None of these is an application defect, and nothing here deletes or files anything.
 */
export interface OrphanReport {
  neverCleaned: ResourceRecord[];
  pending: ResourceRecord[];
  failed: ResourceRecord[];
  /** Everything above, in one list — the full set of cleanup candidates. */
  candidates: ResourceRecord[];
  cleaned: ResourceRecord[];
}

export function findOrphans(records: readonly ResourceRecord[]): OrphanReport {
  const neverCleaned = records.filter((record) => record.state === 'REGISTERED');
  const pending = records.filter((record) => record.state === 'CLEANUP_PENDING');
  const failed = records.filter((record) => record.state === 'CLEANUP_FAILED');
  return {
    neverCleaned,
    pending,
    failed,
    candidates: [...neverCleaned, ...pending, ...failed],
    cleaned: records.filter((record) => record.state === 'CLEANED'),
  };
}
