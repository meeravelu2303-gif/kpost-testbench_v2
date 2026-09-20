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
  | 'no-handler'
  | 'operation-threw'
  /** The operation ran and returned, but its response does not confirm the resource is gone. */
  | 'operation-failed'
  | 'not-owned'
  | 'ledger-rejected';

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
      /*
       * A cleanup operation can fail in two ways, and both must land on CLEANUP_FAILED: it can
       * THROW, or it can RETURN a response that does not confirm the deletion. The second is the
       * common one — every cleanup closure in this repo returns the delete's HTTP status rather than
       * throwing — and treating a returned 500 as success would record "the resource is gone" when
       * the host said it crashed. See `interpretCleanupResult`.
       */
      const verdict = interpretCleanupResult(await operation(record));
      if (verdict.cleaned) {
        this.options.ledger.markCleanupSucceeded(record, verdict.summary);
        this.cleaned += 1;
      } else {
        this.options.ledger.markCleanupFailed(record, verdict.reason);
        this.fail(record, operationName, 'operation-failed', verdict.reason);
      }
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

/** Whether the operation's return value CONFIRMS the resource is gone, and a safe note either way. */
type CleanupVerdict = { cleaned: true; summary: string } | { cleaned: false; reason: string };

/**
 * A returned HTTP status, judged.
 *
 * `CLEANED` is terminal and means "the resource is gone" — so it may only be recorded when the host
 * actually said so. Anything else stays `CLEANUP_FAILED`, which is both honest and *retryable*
 * (`CLEANUP_FAILED → CLEANUP_PENDING` is a legal transition; `CLEANED` is a dead end). Recording an
 * unconfirmed deletion as CLEANED would therefore also foreclose the recovery pass.
 *
 * A 4xx is a failure for the same reason as a 5xx, not a lesser one: the host REJECTED the delete,
 * so nothing was removed. The distinction between "rejected" and "crashed" is preserved in the
 * reason text, which is what a human triaging the cleanup summary needs.
 */
function httpVerdict(status: number): CleanupVerdict {
  if (status >= 200 && status < 300) return { cleaned: true, summary: `deleted (${status})` };
  if (status === 0) {
    return { cleaned: false, reason: 'no HTTP response — the delete never reached the host' };
  }
  return {
    cleaned: false,
    reason: `the host answered HTTP ${status} — the resource is NOT confirmed deleted`,
  };
}

/**
 * What a cleanup operation's RETURN VALUE says about the resource.
 *
 * The contract it formalises is the one the closures already follow: **a returned number, or an
 * object carrying a numeric `status`, is the delete's HTTP status** — every cleanup closure in this
 * repo returns exactly that, and the previous code already rendered it as `deleted (<status>)`. The
 * only change is that the status is now judged rather than merely quoted.
 *
 * Everything else keeps its old meaning, so no existing or future closure has to learn a new rule:
 * returning nothing (the throw-on-failure style) is success, and a string is a caller-supplied note.
 * Nobody has to remember special handling for a 5xx — the boundary does it once, for every operation.
 */
function interpretCleanupResult(result: unknown): CleanupVerdict {
  if (result === undefined || result === null) return { cleaned: true, summary: 'deleted' };
  if (typeof result === 'number' && isHttpStatus(result)) return httpVerdict(result);
  if (typeof result === 'string') {
    return { cleaned: true, summary: redactForJournal(result).slice(0, 120) };
  }
  if (typeof result === 'object' && 'status' in result) {
    const { status } = result;
    if (typeof status === 'number' && isHttpStatus(status)) return httpVerdict(status);
  }
  return { cleaned: true, summary: 'deleted' };
}

/**
 * Whether a returned number is an HTTP status at all.
 *
 * The range check is not a heuristic — HTTP defines status codes as 100–599 — and it matters,
 * because a number is an easy thing to return by accident: `cleanup: () => list.push(id)` yields the
 * array's LENGTH. Without this, such a closure would report a spurious cleanup failure, and the
 * boundary would have introduced a new footgun while fixing another.
 *
 * `0` is included deliberately: it is the bench's own sentinel for "no HTTP response"
 * (`ApiResponseWrapper` sets it on a transport failure), so it must be judged, not ignored.
 */
function isHttpStatus(value: number): boolean {
  return value === 0 || (Number.isInteger(value) && value >= 100 && value <= 599);
}
