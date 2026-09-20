import { redactForJournal, type ResourceIdentity, type ResourceRecord } from './resource-record';
import {
  ResourceLedgerError,
  type ResourceLedger,
  type ResourceRegistration,
} from './resource-ledger';

/**
 * Cleanup that happens because the framework runs it, not because a test remembered to.
 *
 * Phase 2 §17.5 — the CLEANUP step of `allocate → create → track → test → cleanup → release`, built
 * on the Phase 2.4 ledger. Before this, a lifecycle spec deleted its own data on the last line of the
 * test body: an assertion failing three lines earlier skipped the delete, and every delete was
 * wrapped in `.catch(() => undefined)`, so a failed one was invisible. Both are structural problems,
 * and neither is fixed by being more careful.
 *
 * ## What this changes
 *
 *  - **Cleanup runs from a fixture teardown**, so the test body's outcome cannot skip it.
 *  - **LIFO**, because later resources depend on earlier ones (a member before its group).
 *  - **Every attempt goes through the ledger's state machine**, so an interrupted cleanup is
 *    distinguishable from one that never started, and the journal records all of it.
 *  - **A failure is reported, never swallowed** — and never treated as an application defect. A
 *    cleanup problem is an infrastructure dimension; deciding when a failure deserves a bug belongs
 *    to the later defect-confidence work, not here.
 *
 * ## What it deliberately does not do
 *
 * No retries (the state machine supports `CLEANUP_FAILED → CLEANUP_PENDING` for a future recovery
 * pass, but nothing here loops), no sweeping of other runs' leftovers, no deletion of anything this
 * test did not create, and no Bugzilla contact of any kind.
 */

/** How a resource is removed. Receives its record so a handler can be generic over resources. */
export type CleanupOperation = (record: ResourceRecord) => unknown;

/** A reusable operation for every resource of one kind — surface-neutral by construction. */
export interface CleanupHandler {
  kind: string;
  /** What this handler does, for the report (`delete the message`, `restore the field`). */
  description?: string;
  cleanup: CleanupOperation;
}

/** Kind → handler. A per-resource operation (below) always wins over a registered handler. */
export class CleanupRegistry {
  private readonly handlers = new Map<string, CleanupHandler>();

  register(handler: CleanupHandler): this {
    this.handlers.set(handler.kind, handler);
    return this;
  }

  for(kind: string): CleanupHandler | undefined {
    return this.handlers.get(kind);
  }

  kinds(): string[] {
    return [...this.handlers.keys()];
  }
}

/** Registering a resource, optionally with the operation that removes it. */
export interface TrackedResource extends ResourceRegistration {
  /** How to remove THIS resource. Overrides any handler registered for its kind. */
  cleanup?: CleanupOperation;
}

export type CleanupStatus = 'SUCCESS' | 'FAILED' | 'NOT_REQUIRED';

/** Why a cleanup did not succeed — a category a human can act on, plus a safe message. */
export type CleanupErrorCategory =
  'no-handler' | 'operation-threw' | 'not-owned' | 'ledger-rejected';

export interface CleanupFailure {
  kind: string;
  id: string;
  testCaseId: string;
  runId: string;
  slot: number | null;
  /** What was attempted, e.g. `handler:katchup-message` or `inline`. */
  operation: string;
  category: CleanupErrorCategory;
  /** Redacted before it is stored, reported or journalled. */
  message: string;
}

export interface CleanupSummary {
  status: CleanupStatus;
  registered: number;
  attempted: number;
  cleaned: number;
  failed: number;
  failures: CleanupFailure[];
}

/** A cleanup was asked to remove a resource this test/run/slot does not own. Always refused. */
export class CleanupOwnershipError extends ResourceLedgerError {
  override readonly name = 'CleanupOwnershipError';
}

export interface CleanupCoordinatorOptions {
  ledger: ResourceLedger;
  registry?: CleanupRegistry;
  /** Reports a failure as it happens; the summary carries them all regardless. */
  onFailure?: (failure: CleanupFailure) => void;
}

/**
 * Tracks what a test created and removes it afterwards, in reverse order.
 *
 * It holds the cleanup OPERATIONS; the ledger holds the state. There is deliberately no second copy
 * of resource state here — a duplicate model is how two sources of truth start disagreeing.
 */
export class CleanupCoordinator {
  /** Registration order; cleanup walks it backwards. */
  private readonly order: ResourceIdentity[] = [];
  private readonly operations = new Map<string, CleanupOperation>();
  private readonly failures: CleanupFailure[] = [];
  private readonly registry: CleanupRegistry;
  private attempted = 0;
  private cleaned = 0;

  constructor(private readonly options: CleanupCoordinatorOptions) {
    this.registry = options.registry ?? new CleanupRegistry();
  }

  get ledger(): ResourceLedger {
    return this.options.ledger;
  }

  /**
   * Records a resource as this test's responsibility. Call it IMMEDIATELY after creation succeeds:
   * the ledger journals it before the test continues, so a crash a line later still leaves the
   * resource attributable. (A crash BETWEEN creation and this call cannot be detected by anything —
   * an honest limitation, documented rather than papered over.)
   */
  track(resource: TrackedResource): ResourceRecord {
    const record = this.options.ledger.register(resource);
    const key = identityString(record);
    this.order.push(record);
    if (resource.cleanup) this.operations.set(key, resource.cleanup);
    return record;
  }

  /** Registers a reusable operation for every resource of a kind. */
  handle(handler: CleanupHandler): this {
    this.registry.register(handler);
    return this;
  }

  /**
   * Removes everything this test tracked, newest first.
   *
   * Never throws: a cleanup problem must not replace the test's own verdict, and one failed resource
   * must not prevent the rest from being cleaned. Everything lands in the summary.
   */
  async cleanupAll(): Promise<CleanupSummary> {
    for (const identity of [...this.order].reverse()) {
      await this.cleanupOne(identity);
    }
    return this.summary();
  }

  /** Cleans one tracked resource. Exposed so a future recovery pass can act per resource. */
  async cleanupOne(identity: ResourceIdentity): Promise<void> {
    const record = this.options.ledger.get(identity);
    if (!record) {
      this.fail(identity, 'unknown', 'ledger-rejected', 'resource is not tracked by this ledger');
      return;
    }
    // Already cleaned (or terminal) — nothing to do, and no second delete is ever issued.
    if (record.state === 'CLEANED') return;

    const owner = this.options.ledger.owner;
    if (
      record.runId !== owner.runId ||
      record.testCaseId !== owner.testCaseId ||
      record.slot !== owner.slot
    ) {
      // Refuse rather than delete something another test/run/slot owns.
      this.fail(
        record,
        'ownership-check',
        'not-owned',
        `resource belongs to run ${record.runId}, test case ${record.testCaseId}, ` +
          `slot ${String(record.slot)} — this ledger owns run ${owner.runId}, ` +
          `test case ${owner.testCaseId}, slot ${String(owner.slot)}`,
      );
      return;
    }

    const inline = this.operations.get(identityString(record));
    const handler = this.registry.for(record.kind);
    const operation = inline ?? handler?.cleanup;
    const operationName = inline ? 'inline' : handler ? `handler:${handler.kind}` : 'none';
    if (!operation) {
      this.fail(
        record,
        operationName,
        'no-handler',
        `no cleanup operation for kind "${record.kind}" (register one with handle(), or pass ` +
          'cleanup when tracking the resource)',
      );
      return;
    }

    // Recorded BEFORE the attempt, so an interrupted cleanup is visible as CLEANUP_PENDING.
    try {
      this.options.ledger.markCleanupPending(record);
    } catch (error) {
      this.fail(record, operationName, 'ledger-rejected', describeError(error));
      return;
    }

    this.attempted += 1;
    try {
      const result = await operation(record);
      this.options.ledger.markCleanupSucceeded(record, summarizeResult(result));
      this.cleaned += 1;
    } catch (error) {
      const message = describeError(error);
      this.options.ledger.markCleanupFailed(record, message);
      this.fail(record, operationName, 'operation-threw', message);
    }
  }

  summary(): CleanupSummary {
    const registered = this.order.length;
    const failed = this.failures.length;
    return {
      status: registered === 0 ? 'NOT_REQUIRED' : failed > 0 ? 'FAILED' : 'SUCCESS',
      registered,
      attempted: this.attempted,
      cleaned: this.cleaned,
      failed,
      failures: [...this.failures],
    };
  }

  /** Registration order, for tests and for a report that wants to show what was created. */
  tracked(): ResourceRecord[] {
    return this.order
      .map((identity) => this.options.ledger.get(identity))
      .filter((record): record is ResourceRecord => Boolean(record));
  }

  private fail(
    identity: ResourceIdentity,
    operation: string,
    category: CleanupErrorCategory,
    message: string,
  ): void {
    const failure: CleanupFailure = {
      kind: identity.kind,
      id: identity.id,
      testCaseId: identity.testCaseId,
      runId: identity.runId,
      slot: identity.slot,
      operation,
      category,
      message: redactForJournal(message),
    };
    this.failures.push(failure);
    this.options.onFailure?.(failure);
  }
}

function identityString(identity: ResourceIdentity): string {
  return `${identity.kind}|${identity.id}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** A short, safe note of what the operation returned — a status code is the useful case. */
function summarizeResult(result: unknown): string {
  if (result === undefined || result === null) return 'deleted';
  if (typeof result === 'number') return `deleted (${result})`;
  if (typeof result === 'string') return redactForJournal(result).slice(0, 120);
  if (typeof result === 'object' && 'status' in result) {
    const { status } = result;
    if (typeof status === 'number') return `deleted (${status})`;
  }
  return 'deleted';
}
