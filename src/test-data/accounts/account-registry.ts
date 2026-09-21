import {
  accountKey,
  assertNoSecrets,
  canTransition,
  TestAccountError,
  type AccountSource,
  type TestAccountRecord,
  type TestAccountStatus,
} from './account-record';

/**
 * The account registry — persistent knowledge of the accounts automation created.
 *
 * ## Its one job
 *
 * Answer "which accounts exist, where, and are they still usable?". It performs no HTTP, drives no
 * browser, knows nothing about signup, and holds no credential. A flow calls it AFTER the
 * application has confirmed a creation; the dependency runs one way only.
 *
 *     signup flow  ──►  AccountRegistry        (never the reverse)
 *
 * ## Its relationship with the pieces that already exist
 *
 *     AccountRegistry   which accounts EXIST and their bench lifecycle      (this file — new)
 *     AccountPool       which accounts a SLOT may log in as, + credentials  (unchanged)
 *     ResourceLedger    what ONE RUN created and whether it cleaned up      (unchanged)
 *     ActorContext      which account plays which ROLE in one flow run      (unchanged)
 *
 * None replaces another. The registry supplies identity; the pool still owns credentials and slot
 * partitioning; the ledger still owns per-run cleanup; `ActorContext` still binds a role to an
 * account. A guard asserts this module imports none of them.
 *
 * ## Deterministic and idempotent
 *
 * `register()` on an account the registry already holds returns the existing record rather than
 * creating a second one. That matters more than it looks: signup on this product is not repeatable —
 * an account cannot be deleted, so a re-run answers "already exists" — and a registry that appended
 * a fresh row each time would slowly fill with duplicates of one real account.
 */

/** What a caller supplies. `accountId`, `status`, `usageCount` and timestamps are the registry's. */
export interface AccountRegistration {
  readonly kpostId: string;
  readonly environment: string;
  readonly source: AccountSource;
  /** Creation must be CONFIRMED by application evidence, never by an HTTP code alone. */
  readonly verified: boolean;
  readonly verificationNote?: string;
  readonly email?: string;
  readonly userType?: string;
  readonly role?: string;
  readonly signupFlowId?: string;
  readonly createdBy?: string;
}

/** Where the registry keeps its records. Implemented by the JSONL store; trivial to replace. */
export interface AccountStore {
  load(): TestAccountRecord[];
  /** Appends one record state. The store decides how that is persisted. */
  append(record: TestAccountRecord): void;
}

/** An in-memory store, for tests and for a run that must not touch disk. */
export class InMemoryAccountStore implements AccountStore {
  private readonly rows: TestAccountRecord[] = [];
  load(): TestAccountRecord[] {
    return [...this.rows];
  }
  append(record: TestAccountRecord): void {
    this.rows.push(record);
  }
}

const nowIso = (): string => new Date().toISOString();

export class AccountRegistry {
  /** accountKey → the current record. Rebuilt from the store on construction. */
  private readonly byKey = new Map<string, TestAccountRecord>();
  private readonly byId = new Map<string, TestAccountRecord>();

  constructor(
    private readonly store: AccountStore,
    /** Minting an id is injectable so a test gets deterministic ids without stubbing a clock. */
    private readonly mintId: (index: number) => string = (index) =>
      `tba-${String(index).padStart(5, '0')}`,
  ) {
    // Fold the stored events into current state: the LAST record for a key wins, exactly as the
    // resource journal reconstructs a resource's state from its event lines.
    for (const record of store.load()) {
      this.byKey.set(accountKey(record), record);
      this.byId.set(record.accountId, record);
    }
  }

  private put(record: TestAccountRecord): TestAccountRecord {
    assertNoSecrets(record as unknown as Record<string, unknown>);
    this.byKey.set(accountKey(record), record);
    this.byId.set(record.accountId, record);
    this.store.append(record);
    return record;
  }

  /**
   * Records an account the application has CONFIRMED exists.
   *
   * Idempotent by `(environment, kpostId)`: registering the same account twice returns the record
   * already held and appends nothing.
   */
  register(registration: AccountRegistration): TestAccountRecord {
    assertNoSecrets(registration as unknown as Record<string, unknown>);

    const kpostId = registration.kpostId.trim();
    if (!kpostId) throw new TestAccountError('an account needs a kpostId — it is THE identity');
    if (!registration.environment.trim()) {
      throw new TestAccountError(
        'an account needs an environment: the same id on another deployment is another account',
      );
    }

    const key = accountKey({ environment: registration.environment, kpostId });
    const existing = this.byKey.get(key);
    if (existing) return existing;

    return this.put({
      accountId: this.mintId(this.byId.size + 1),
      kpostId,
      ...(registration.email !== undefined ? { email: registration.email } : {}),
      ...(registration.userType !== undefined ? { userType: registration.userType } : {}),
      ...(registration.role !== undefined ? { role: registration.role } : {}),
      environment: registration.environment,
      status: 'CREATED',
      createdAt: nowIso(),
      createdBy: registration.createdBy ?? 'test-bench',
      ...(registration.signupFlowId !== undefined
        ? { signupFlowId: registration.signupFlowId }
        : {}),
      verified: registration.verified,
      ...(registration.verificationNote !== undefined
        ? { verificationNote: registration.verificationNote }
        : {}),
      source: registration.source,
      usageCount: 0,
    });
  }

  // ---- retrieval -------------------------------------------------------------------------------

  get(accountId: string): TestAccountRecord | undefined {
    return this.byId.get(accountId);
  }

  /**
   * Finds by the KPOST identity.
   *
   * `environment` is required: without it the same id on two deployments would collide, which is
   * precisely the cross-environment reuse this registry exists to make impossible.
   */
  findByKpostId(environment: string, kpostId: string): TestAccountRecord | undefined {
    return this.byKey.get(accountKey({ environment, kpostId }));
  }

  /** Finds by contact address. Returns every match, since an address is not a unique identity here. */
  findByEmail(email: string): TestAccountRecord[] {
    const wanted = email.trim().toLowerCase();
    return this.all().filter(
      (record) => record.email?.toLowerCase() === wanted || record.kpostId.toLowerCase() === wanted,
    );
  }

  all(): TestAccountRecord[] {
    return [...this.byId.values()];
  }

  /** Accounts usable by automation: ACTIVE, and confirmed to exist. */
  listActive(environment?: string): TestAccountRecord[] {
    return this.all().filter(
      (record) =>
        record.status === 'ACTIVE' &&
        record.verified &&
        (environment === undefined || record.environment === environment),
    );
  }

  listByRole(role: string, environment?: string): TestAccountRecord[] {
    return this.all().filter(
      (record) =>
        record.role === role && (environment === undefined || record.environment === environment),
    );
  }

  listByEnvironment(environment: string): TestAccountRecord[] {
    return this.all().filter((record) => record.environment === environment);
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  private requireRecord(accountId: string): TestAccountRecord {
    const record = this.byId.get(accountId);
    if (!record) throw new TestAccountError(`no account "${accountId}" in the registry`);
    return record;
  }

  /** Notes that a run used the account. */
  markUsed(accountId: string): TestAccountRecord {
    const record = this.requireRecord(accountId);
    return this.put({ ...record, lastUsedAt: nowIso(), usageCount: record.usageCount + 1 });
  }

  /** Moves the account's lifecycle on, refusing a transition the state machine does not allow. */
  updateStatus(accountId: string, status: TestAccountStatus, reason?: string): TestAccountRecord {
    const record = this.requireRecord(accountId);
    if (record.status === status) return record;
    if (!canTransition(record.status, status)) {
      throw new TestAccountError(
        `account "${accountId}" cannot move ${record.status} → ${status}. A terminal state is ` +
          'terminal, and an illegal move would make the history unreadable.',
      );
    }
    return this.put({
      ...record,
      status,
      ...(reason !== undefined ? { statusReason: reason } : {}),
      ...(status === 'RETIRED' ? { retiredAt: nowIso() } : {}),
    });
  }

  /**
   * The bench will not use this account again, though it still EXISTS.
   *
   * The honest terminal state for this product: KPOST exposes no way to delete a signup account, so
   * `CLEANED` would be a claim nothing supports.
   */
  retire(accountId: string, reason: string): TestAccountRecord {
    return this.updateStatus(accountId, 'RETIRED', reason);
  }

  /** Accounts recorded but NOT confirmed to exist — never reuse one without re-checking. */
  unverified(): TestAccountRecord[] {
    return this.all().filter((record) => !record.verified);
  }
}
