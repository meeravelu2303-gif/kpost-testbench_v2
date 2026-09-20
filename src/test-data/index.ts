import { AUTH_PROFILES } from '@config/auth-profile';
import { env } from '@config/env';
import { AccountPool, currentSlotIndex, type SlotAccounts } from './account-pool';

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
