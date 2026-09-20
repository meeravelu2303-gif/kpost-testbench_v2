import path from 'node:path';
import { AUTH_PROFILES } from '@config/auth-profile';
import { ROOT_DIR } from '@config/constants';
import { env } from '@config/env';
import { AccountPool, currentSlotIndex, type SlotAccounts } from './account-pool';
import { CleanupCoordinator } from './cleanup';
import { ResourceLedger } from './resource-ledger';
import { DEFAULT_JOURNAL_FILE, FileResourceJournal } from './resource-journal';

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
