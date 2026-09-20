import {
  allowedTransitionsFrom,
  canTransition,
  redactForJournal,
  resourceKey,
  type ResourceIdentity,
  type ResourceOwner,
  type ResourceRecord,
  type ResourceState,
} from './resource-record';
import {
  NULL_JOURNAL_SINK,
  type ResourceEvent,
  type ResourceJournalSink,
} from './resource-journal';
import { rememberOwnedResource } from './owned-resources';

/**
 * The one place that knows what this run created.
 *
 * Phase 2 §17.4, the TRACK step. A test hands the ledger a resource the moment it exists; the ledger
 * records ownership (run, test case, account slot), appends a durable event, and from then on the
 * resource has a state that can only change through the transition table.
 *
 * **It does not clean anything up.** No delete, no HTTP call, no KPost. Performing cleanup, wiring it
 * into fixtures, and sweeping leftovers are later phases — this one builds the data model and the
 * durable evidence they need. Nothing here reaches Bugzilla either: a leftover resource is an
 * infrastructure observation, never a product defect.
 *
 * One ledger serves every surface (API, UI, Admin, KMail). A per-surface ledger would make "what did
 * this run create?" unanswerable without joining several sources, which is the question the whole
 * mechanism exists to answer.
 */

export class ResourceLedgerError extends Error {
  // Widened (not a literal) so the specific errors below can narrow it to their own name.
  override readonly name: string = 'ResourceLedgerError';
}

/** Registering one identity twice — the ledger refuses rather than overwrite a record. */
export class DuplicateResourceError extends ResourceLedgerError {
  override readonly name = 'DuplicateResourceError';
  constructor(
    readonly existing: ResourceRecord,
    message: string,
  ) {
    super(message);
  }
}

/** A state change the machine forbids (e.g. cleaning an already-cleaned resource). */
export class InvalidResourceTransitionError extends ResourceLedgerError {
  override readonly name = 'InvalidResourceTransitionError';
  constructor(
    readonly from: ResourceState,
    readonly to: ResourceState,
    message: string,
  ) {
    super(message);
  }
}

/** Unknown resource — asking about something that was never tracked. */
export class UnknownResourceError extends ResourceLedgerError {
  override readonly name = 'UnknownResourceError';
}

/** What a caller supplies when a resource comes into existence. */
export interface ResourceRegistration {
  kind: string;
  /** The identifier a future cleanup would delete by. Coerced to a string so `msgID: 123` works. */
  id: string | number;
  /** Human label. Masked before it is stored or persisted. */
  describe?: string;
  /** Overrides the ledger's owner for this one resource (rarely needed). */
  owner?: Partial<ResourceOwner>;
}

export interface ResourceLedgerOptions {
  /** Ownership every registration inherits: the run, the test case, the account slot. */
  owner: ResourceOwner;
  /** Where durable events go. Defaults to nowhere, so a ledger is inert unless given a journal. */
  journal?: ResourceJournalSink;
  /** Injectable clock, so tests assert timestamps without sleeping. */
  now?: () => Date;
}

export class ResourceLedger {
  private readonly records = new Map<string, ResourceRecord>();
  private readonly journal: ResourceJournalSink;
  private readonly now: () => Date;

  constructor(private readonly options: ResourceLedgerOptions) {
    this.journal = options.journal ?? NULL_JOURNAL_SINK;
    this.now = options.now ?? ((): Date => new Date());
  }

  get owner(): ResourceOwner {
    return this.options.owner;
  }

  /**
   * Records a resource as this run's responsibility, and durably says so BEFORE the test continues —
   * a crash one line later still leaves the resource identifiable.
   *
   * Registering the same identity twice throws, naming the existing record: two different resources
   * reported as one would make the history meaningless, and silently overwriting is how a leftover
   * becomes invisible.
   */
  register(registration: ResourceRegistration): ResourceRecord {
    const identity = this.identityOf(registration);
    const key = resourceKey(identity);
    const existing = this.records.get(key);
    if (existing) {
      throw new DuplicateResourceError(
        existing,
        `Resource already registered: ${identity.kind} "${identity.id}" ` +
          `(run ${identity.runId}, test case ${identity.testCaseId}, slot ${String(identity.slot)}), ` +
          `registered at ${existing.registeredAt} and currently ${existing.state}. ` +
          'Register each resource once; use update()/markCleanup* to change its state.',
      );
    }

    const registeredAt = this.now().toISOString();
    const record: ResourceRecord = {
      ...identity,
      describe: redactForJournal(registration.describe ?? `${identity.kind} ${identity.id}`),
      registeredAt,
      state: 'REGISTERED',
      cleanupResult: null,
      updatedAt: null,
    };
    this.records.set(key, record);
    /*
     * Ownership is published the moment the resource exists, so the QA-identifier guard can tell a
     * message this run created from one belonging to somebody else. Registration is the only way an
     * id gets in — see owned-resources.ts.
     */
    rememberOwnedResource(identity);
    this.appendEvent('registered', record);
    return record;
  }

  /** `register`, by the name the lifecycle reads best: `ledger.track({ kind, id })`. */
  track(registration: ResourceRegistration): ResourceRecord {
    return this.register(registration);
  }

  /**
   * Moves a resource to a new state. The transition table is the only authority, so an impossible
   * history (cleaned → pending, failed → cleaned without a retry) cannot be written.
   */
  update(
    identity: ResourceIdentity | ResourceRegistration,
    state: ResourceState,
    cleanupResult?: string,
  ): ResourceRecord {
    const record = this.require(identity);
    if (!canTransition(record.state, state)) {
      const allowed = allowedTransitionsFrom(record.state);
      throw new InvalidResourceTransitionError(
        record.state,
        state,
        `${record.kind} "${record.id}" is ${record.state}; ${record.state} → ${state} is not a ` +
          `legal transition (allowed: ${allowed.length ? allowed.join(', ') : 'none — terminal'}).`,
      );
    }

    const updated: ResourceRecord = {
      ...record,
      state,
      cleanupResult:
        cleanupResult === undefined ? record.cleanupResult : redactForJournal(cleanupResult),
      updatedAt: this.now().toISOString(),
    };
    this.records.set(resourceKey(record), updated);
    this.appendEvent('transition', updated);
    return updated;
  }

  /** Cleanup is about to be attempted — recorded first, so an interrupted attempt is visible. */
  markCleanupPending(identity: ResourceIdentity | ResourceRegistration): ResourceRecord {
    return this.update(identity, 'CLEANUP_PENDING');
  }

  /** The resource is gone. Terminal. */
  markCleanupSucceeded(
    identity: ResourceIdentity | ResourceRegistration,
    result = 'deleted',
  ): ResourceRecord {
    return this.update(identity, 'CLEANED', result);
  }

  /** Cleanup ran and did not remove it. Stays visible: this is never swallowed. */
  markCleanupFailed(
    identity: ResourceIdentity | ResourceRegistration,
    reason: string,
  ): ResourceRecord {
    return this.update(identity, 'CLEANUP_FAILED', reason);
  }

  get(identity: ResourceIdentity | ResourceRegistration): ResourceRecord | undefined {
    return this.records.get(resourceKey(this.identityOf(identity)));
  }

  has(identity: ResourceIdentity | ResourceRegistration): boolean {
    return this.records.has(resourceKey(this.identityOf(identity)));
  }

  list(filter?: (record: ResourceRecord) => boolean): ResourceRecord[] {
    const all = [...this.records.values()];
    return filter ? all.filter(filter) : all;
  }

  getByTestCase(testCaseId: string): ResourceRecord[] {
    return this.list((record) => record.testCaseId === testCaseId);
  }

  getByRun(runId: string): ResourceRecord[] {
    return this.list((record) => record.runId === runId);
  }

  getBySlot(slot: number | null): ResourceRecord[] {
    return this.list((record) => record.slot === slot);
  }

  count(state?: ResourceState): number {
    return state ? this.list((record) => record.state === state).length : this.records.size;
  }

  /** Everything still outstanding — what a later cleanup phase would act on. */
  outstanding(): ResourceRecord[] {
    return this.list((record) => record.state !== 'CLEANED');
  }

  private identityOf(input: ResourceIdentity | ResourceRegistration): ResourceIdentity {
    const owner = 'owner' in input && input.owner ? input.owner : {};
    const base = input as Partial<ResourceIdentity>;
    return {
      runId: base.runId ?? owner.runId ?? this.options.owner.runId,
      testCaseId: base.testCaseId ?? owner.testCaseId ?? this.options.owner.testCaseId,
      slot: base.slot !== undefined ? base.slot : (owner.slot ?? this.options.owner.slot),
      kind: input.kind,
      id: String(input.id),
    };
  }

  private require(input: ResourceIdentity | ResourceRegistration): ResourceRecord {
    const identity = this.identityOf(input);
    const record = this.records.get(resourceKey(identity));
    if (!record) {
      throw new UnknownResourceError(
        `No tracked resource ${identity.kind} "${identity.id}" for run ${identity.runId}, ` +
          `test case ${identity.testCaseId}, slot ${String(identity.slot)}. ` +
          'Register it before changing its state.',
      );
    }
    return record;
  }

  private appendEvent(event: ResourceEvent['event'], record: ResourceRecord): void {
    this.journal.append({
      event,
      eventAt: record.updatedAt ?? record.registeredAt,
      runId: record.runId,
      testCaseId: record.testCaseId,
      slot: record.slot,
      kind: record.kind,
      id: record.id,
      describe: record.describe,
      registeredAt: record.registeredAt,
      state: record.state,
      cleanupResult: record.cleanupResult,
    });
  }
}
