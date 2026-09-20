import type { Principal, Role } from '@config/auth.config';

/**
 * Who a test may LOG IN as — decided centrally, by logical slot, instead of by each spec.
 *
 * Phase 2 §17.3. This is not credential management; it is **session ownership**.
 *
 * ## The failure it makes impossible
 *
 * A KPost account allows ONE active session: a second login displaces the first. Two workers driving
 * the same account therefore do not merely race over data — they sign each other out, and the victim
 * sees 401/403 on calls that were fine a moment ago. That reads as an application defect and can
 * reach a developer as a false bug. Ten specs used to pick their own principals by key, so nothing
 * could see the collision coming and the only safe worker count was 1.
 *
 * ## How allocation works: a fixed partition, not a lease
 *
 *     slot 0 → accounts [0..n)      slot 1 → accounts [n..2n)      …
 *
 * Playwright workers are separate processes, so anything negotiated at runtime would need IPC or a
 * lock file — stale locks, crash recovery, heartbeats. A partition needs no coordination at all: two
 * slots cannot collide because their slices are disjoint by construction, which a unit test can
 * prove. A crashed worker's replacement inherits the SAME slot and therefore the same accounts, so
 * there is nothing to reclaim.
 *
 * **Slot identity is `parallelIndex`, never `workerIndex`.** `parallelIndex` is the slot number
 * bounded by `--workers`; `workerIndex` increments when a worker is replaced. Keying on the slot is
 * what makes a restart safe.
 *
 * ## Inventory is configuration, never a constant
 *
 * The session inventory is every configured PERSONAL principal, in declaration order
 * (`src/config/auth-profile.ts`), which on a live run is already filtered to accounts whose id is
 * explicitly set in `.env`. Adding `QA_PERSONAL_7_KPOST_ID` and its principal raises capacity with no
 * change here: no account count is written into this file, and none may be.
 *
 * Slot 0 receives exactly the accounts the specs used before the pool existed, so a single-worker run
 * is unchanged.
 */

/** A configuration/infrastructure failure — never an application defect. See §19 of the design. */
export class AccountPoolError extends Error {
  override readonly name = 'AccountPoolError';
}

/** How an account is being used. The session/reference split is the whole point of the pool. */
export type AccountUse =
  /** The bench LOGS IN as it. Exclusive to one slot, because a second login displaces the first. */
  | 'session'
  /** Named in a payload as a target (a recipient, a directory entry). No session, no mutation. */
  | 'reference'
  /** A session account whose own state a test changes, so it also owes a restoration. */
  | 'mutable';

export interface PooledAccount {
  /** Stable, non-secret label used in reports and logs — never the credential. */
  readonly key: string;
  readonly role: Role;
  /** Account tier, the repository's own term (`PERSONAL`, `BUSINESS_S/M/L`). */
  readonly userType: string | undefined;
  /** The credentials, for the executor. Non-enumerable: it can never be serialised by accident. */
  readonly principal: Principal;
  /** Report-safe projection. `JSON.stringify` uses it, so a leak needs deliberate effort. */
  toJSON(): { key: string; role: Role; userType: string | undefined };
}

function pooled(principal: Principal): PooledAccount {
  const account = {
    key: principal.key,
    role: principal.role,
    userType: principal.userType,
    toJSON() {
      // Deliberately no username and no password: a slot printed into a report or an error stays safe.
      return { key: principal.key, role: principal.role, userType: principal.userType };
    },
  } as PooledAccount;
  // Non-enumerable, so `JSON.stringify(account)` and `{...account}` in a log never reach credentials.
  Object.defineProperty(account, 'principal', {
    value: principal,
    enumerable: false,
    writable: false,
  });
  return account;
}

/** The accounts one logical slot owns. A slot never sees another slot's session accounts. */
export interface SlotAccounts {
  readonly index: number;
  readonly size: number;
  /** The slot's session accounts, in order. Position 0 is the primary actor. */
  readonly sessions: readonly PooledAccount[];
  /** One session account by position; out of range is a configuration error, never a silent undefined. */
  session(position: number): PooledAccount;
  /** The first `count` principals — the shape existing specs already pass to the executor. */
  principals(count?: number): Principal[];
  /** Report-safe: the account keys this slot owns. */
  keys(): string[];
  toJSON(): { slot: number; accounts: string[] };
}

export interface AccountPoolOptions {
  /**
   * Session accounts one slot owns. Comes from the active run profile
   * (`accounts.sessionPerWorker`); falls back to the whole inventory, which is what a single-slot
   * legacy run needs.
   */
  defaultSlotSize?: number;
}

export class AccountPool {
  private constructor(
    private readonly sessionAccounts: readonly PooledAccount[],
    private readonly namedAccounts: ReadonlyMap<string, PooledAccount>,
    private readonly defaultSlotSize: number | undefined,
  ) {}

  /**
   * Builds a pool from configured principals. Session inventory = the PERSONAL user accounts in
   * declaration order; business identities are per tier and are requested by key, never partitioned,
   * because a BUSINESS_M admin cannot stand in for a BUSINESS_S one.
   */
  static fromPrincipals(
    principals: readonly Principal[],
    options: AccountPoolOptions = {},
  ): AccountPool {
    const accounts = principals.map(pooled);
    const sessions = accounts.filter(
      (account) => account.role === 'USER' && (account.userType ?? 'PERSONAL') === 'PERSONAL',
    );
    return new AccountPool(
      sessions,
      new Map(accounts.map((account) => [account.key, account])),
      options.defaultSlotSize,
    );
  }

  /** Every session account available to partition. Report-safe (keys only). */
  inventory(): string[] {
    return this.sessionAccounts.map((account) => account.key);
  }

  /** How many slots can each own `accountsPerSlot` session accounts without overlapping. */
  capacityFor(accountsPerSlot: number): number {
    if (accountsPerSlot <= 0) return Number.POSITIVE_INFINITY;
    return Math.floor(this.sessionAccounts.length / accountsPerSlot);
  }

  /**
   * Refuses a run whose parallelism the account inventory cannot serve. Refusal, never clamping:
   * quietly running fewer workers would leave the operator believing an isolation property that does
   * not hold, and the whole point of the pool is that session collisions are impossible.
   */
  assertCapacity(slots: number, accountsPerSlot: number): void {
    const capacity = this.capacityFor(accountsPerSlot);
    if (slots <= capacity) return;
    throw new AccountPoolError(
      'Account capacity exceeded.\n\n' +
        `Requested logical slots: ${slots}\n` +
        `Configured account capacity: ${capacity} (${this.sessionAccounts.length} session ` +
        `account(s) ÷ ${accountsPerSlot} per slot)\n\n` +
        'No safe account allocation exists. Execution refused to prevent session collision.\n' +
        'Configure more QA accounts (QA_PERSONAL_*_KPOST_ID plus their principal), or run with ' +
        `at most ${capacity} worker(s).`,
    );
  }

  /**
   * The account set for one logical slot. `size` defaults to the active profile's declared need,
   * then to the whole inventory (the single-slot case). The partition is positional, so the same
   * slot always receives the same accounts, on every machine and every run.
   */
  slot(index: number, size?: number): SlotAccounts {
    if (!Number.isInteger(index) || index < 0) {
      throw new AccountPoolError(
        `Slot index must be a non-negative integer (got ${String(index)}).`,
      );
    }
    const requested = size ?? this.defaultSlotSize ?? this.sessionAccounts.length;
    if (requested <= 0) {
      throw new AccountPoolError(
        `Slot ${index} was asked for ${requested} session account(s); a slot needs at least one.`,
      );
    }
    this.assertCapacity(index + 1, requested);

    const start = index * requested;
    const sessions = this.sessionAccounts.slice(start, start + requested);
    return {
      index,
      size: requested,
      sessions,
      session(position: number): PooledAccount {
        const account = sessions[position];
        if (!account) {
          throw new AccountPoolError(
            `Slot ${index} owns ${sessions.length} session account(s); position ${position} was ` +
              'requested. Declare the need in the run profile (accounts.sessionPerWorker).',
          );
        }
        return account;
      },
      principals(count?: number): Principal[] {
        const wanted = count ?? sessions.length;
        if (wanted > sessions.length) {
          throw new AccountPoolError(
            `Slot ${index} owns ${sessions.length} session account(s); ${wanted} requested.`,
          );
        }
        return sessions.slice(0, wanted).map((account) => account.principal);
      },
      keys: () => sessions.map((account) => account.key),
      toJSON: () => ({ slot: index, accounts: sessions.map((account) => account.key) }),
    };
  }

  /**
   * A named account (a business tier, the admin identity). Tiers are part of the credential, so they
   * are requested by key; an unconfigured one fails clearly instead of silently substituting.
   */
  named(key: string): PooledAccount {
    const account = this.namedAccounts.get(key);
    if (!account) {
      throw new AccountPoolError(
        `No configured account with key "${key}". Configured: ` +
          `${[...this.namedAccounts.keys()].join(', ') || '(none)'}. ` +
          'Set its QA_* id in .env (see .env.example) — this is a configuration gap, not a defect.',
      );
    }
    return account;
  }

  /** Whether a named account exists, for a spec that must skip rather than fail. */
  has(key: string): boolean {
    return this.namedAccounts.has(key);
  }
}

/**
 * The logical slot of the current process. Playwright sets `TEST_PARALLEL_INDEX` per worker;
 * `testInfo.parallelIndex` is the same number inside a test. `TEST_WORKER_INDEX` is deliberately NOT
 * used: it changes when a worker is replaced, and account ownership must survive that.
 */
export function currentSlotIndex(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const index = Number.parseInt(environment.TEST_PARALLEL_INDEX ?? '', 10);
  return Number.isInteger(index) && index >= 0 ? index : 0;
}
