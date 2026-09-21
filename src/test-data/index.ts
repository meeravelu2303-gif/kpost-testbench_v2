import path from 'node:path';
import { AUTH_PROFILES } from '@config/auth-profile';
import { ROOT_DIR } from '@config/constants';
import { env } from '@config/env';
import type { Principal } from '@config/auth.config';
import { AccountPool, currentSlotIndex, type SlotAccounts } from './account-pool';
import { lazyPrincipals } from './lazy-principals';
import { CleanupCoordinator } from './cleanup';
import { ResourceLedger } from './resource-ledger';
import { DEFAULT_JOURNAL_FILE, FileResourceJournal } from './resource-journal';
import { AccountRegistry } from './accounts/account-registry';
import { JsonlAccountStore } from './accounts/account-store';
import { environmentOf } from './accounts/environment';

/**
 * The configured account pool for this process.
 *
 * Inventory comes from the KPost principals (already filtered on a live run to accounts whose id is
 * explicitly set in `.env`), and the per-slot size from the ACTIVE RUN PROFILE's declared need
 * (`accounts.sessionPerWorker`, Phase 2.1). With no profile — every legacy command — a slot owns the
 * whole inventory, which is exactly what a single-slot run had before the pool existed.
 */
export const accountPool = AccountPool.fromPrincipals(AUTH_PROFILES.kpost.principals, {
  defaultSlotSize: env.PROFILE.accounts.sessionPerWorker || undefined,
});

/** The account set this worker owns, by its logical slot (`parallelIndex`). */
export function currentSlot(size?: number): SlotAccounts {
  return accountPool.slot(currentSlotIndex(), size);
}

/**
 * This slot's first `count` principals, resolved on first USE rather than at module load.
 *
 * Identical allocation to `currentSlot().principals(count)` — same slot, same accounts, same order
 * — but a spec that a `--grep` discards never asks, so it cannot fail the run of the specs that
 * were selected. See `lazy-principals.ts` for the failure this removes.
 */
export function slotPrincipals(count: number): Principal[] {
  return lazyPrincipals((wanted) => currentSlot().principals(wanted), count);
}

export { lazyPrincipals } from './lazy-principals';
export {
  AccountPool,
  AccountPoolError,
  currentSlotIndex,
  type AccountUse,
  type PooledAccount,
  type SlotAccounts,
} from './account-pool';

/**
 * Resource tracking (Phase 2.4). The ledger records what a run created and the journal makes that
 * record survive a crashed worker. **Nothing here performs cleanup** — that, and wiring it into the
 * lifecycle fixtures, is a later phase.
 */
export {
  DuplicateResourceError,
  InvalidResourceTransitionError,
  ResourceLedger,
  ResourceLedgerError,
  UnknownResourceError,
  type ResourceLedgerOptions,
  type ResourceRegistration,
} from './resource-ledger';
export {
  DEFAULT_JOURNAL_FILE,
  FileResourceJournal,
  findOrphans,
  NULL_JOURNAL_SINK,
  readJournalFile,
  readJournalText,
  ResourceJournalError,
  type JournalIssue,
  type JournalReadResult,
  type OrphanReport,
  type ResourceEvent,
  type ResourceJournalSink,
} from './resource-journal';
/**
 * What this run created, published for the QA-identifier guard so a runtime-id field (a Katchup
 * `messageIds`) can name our own resources and still refuse a stranger's. Written only by the
 * ledger's `register()`.
 */
export {
  forgetOwnedResources,
  ownedResourceIds,
  ownerOfResource,
  ownsResource,
  rememberOwnedResource,
} from './owned-resources';
export {
  allowedTransitionsFrom,
  canTransition,
  isResourceState,
  redactForJournal,
  resourceKey,
  RESOURCE_STATES,
  type ResourceIdentity,
  type ResourceOwner,
  type ResourceRecord,
  type ResourceState,
} from './resource-record';

/**
 * Ownership for a ledger created in this process: the canonical run id (`TEST_RUN_ID`, the bench's
 * one run identity) and this worker's logical slot (`parallelIndex`, Phase 2.3). The test case id
 * is supplied by the caller, because only the test knows which case it is.
 */
export function ledgerOwner(testCaseId: string, slot: number | null = currentSlotIndex()) {
  return { runId: env.TEST_RUN_ID, testCaseId, slot };
}

export {
  CleanupCoordinator,
  CleanupOwnershipError,
  CleanupRegistry,
  type CleanupErrorCategory,
  type CleanupFailure,
  type CleanupHandler,
  type CleanupOperation,
  type CleanupStatus,
  type CleanupSummary,
  type TrackedResource,
} from './cleanup';

/**
 * A cleanup coordinator for one test, wired to a ledger that journals to `reports/resources.jsonl`.
 *
 * Ownership comes from the pieces the earlier phases already established: the canonical run id
 * (`TEST_RUN_ID`), the stable test-case id (Phase 2.2) and the logical account slot (Phase 2.3,
 * `parallelIndex`). Nothing new identifies anything.
 */
export function createTestCleanup(options: {
  testCaseId: string;
  slot: number | null;
  journalFile?: string;
}): CleanupCoordinator {
  const ledger = new ResourceLedger({
    owner: { runId: env.TEST_RUN_ID, testCaseId: options.testCaseId, slot: options.slot },
    journal: new FileResourceJournal(
      path.join(ROOT_DIR, options.journalFile ?? DEFAULT_JOURNAL_FILE),
    ),
  });
  return new CleanupCoordinator({ ledger });
}

// ---- the account registry (Phase 4D) ------------------------------------------------------------

/*
 * Re-exported by NAME, not with `export *`.
 *
 * `./resource-record` and `./accounts/account-record` both export `canTransition` and
 * `allowedTransitionsFrom` — one over `ResourceState`, one over `TestAccountStatus`. This file
 * already exports the resource pair explicitly above, and ES semantics make an explicit export win
 * over a conflicting star-export: the ACCOUNT pair was therefore silently dropped from this barrel,
 * with nothing to say so.
 *
 * Nothing broke, because every account consumer imports `src/test-data/accounts/index` directly. But
 * a silent omission is a trap for the next caller, who would reach for `canTransition` here, receive
 * the resource-lifecycle one, and get a type error naming states they never mentioned. Listing the
 * names makes the boundary explicit: the two colliding helpers are deliberately NOT surfaced here,
 * and are imported from `src/test-data/accounts/index` — which is also where the account lifecycle
 * belongs, since it is a different vocabulary from the resource ledger's (see `account-record.ts`).
 */
export {
  ACCOUNT_SOURCES,
  AccountRegistry,
  AccountStoreError,
  FORBIDDEN_ACCOUNT_KEYS,
  InMemoryAccountStore,
  JsonlAccountStore,
  TEST_ACCOUNT_STATUSES,
  TestAccountError,
  accountKey,
  assertNoSecrets,
  assertSameEnvironment,
  environmentOf,
  isTestAccountStatus,
  matchesEnvironment,
  parseAccountLines,
  type AccountRegistration,
  type AccountSource,
  type AccountStore,
  type AccountStoreProblem,
  type TestAccountRecord,
  type TestAccountStatus,
} from './accounts/index';

/** Where the durable account registry lives. Test-bench DATA, not a report — see the note below. */
export const DEFAULT_ACCOUNT_REGISTRY_FILE = path.join('test-data', 'accounts', 'accounts.jsonl');

/**
 * The account registry for this process, backed by the durable JSONL file.
 *
 * Kept in `test-data/` rather than `reports/` on purpose: `reports/` holds the OUTPUT of a run and is
 * regenerated per suite, whereas the registry must outlive every run — an account cannot be deleted
 * on this product, so forgetting one is permanent. It is git-ignored, because it names real accounts
 * on a live deployment and those identities do not belong in the repository's history.
 */
export function accountRegistry(file = DEFAULT_ACCOUNT_REGISTRY_FILE): AccountRegistry {
  return new AccountRegistry(new JsonlAccountStore(path.join(ROOT_DIR, file)));
}

/** The environment label of the KPost deployment this process targets. */
export function currentEnvironment(): string {
  // An unset host throws with the reason rather than defaulting: an account recorded against a
  // guessed environment could be reused against a deployment it does not exist on.
  return environmentOf(env.KPOST_API_BASE_URL ?? '');
}
