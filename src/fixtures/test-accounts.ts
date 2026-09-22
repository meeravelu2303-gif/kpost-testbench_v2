import { z } from 'zod';
import registry from './test-accounts.json' with { type: 'json' };

/**
 * The single source of truth for which accounts the bench uses, and in which ROLE.
 *
 * ## Why a registry rather than `.env` values reached for directly
 *
 * Accounts were previously named by whichever spec needed one, so "which account does this test act
 * as?" could only be answered by reading the test. That matters more than tidiness: a flow that
 * sends between two accounts is meaningless if both ends turn out to be the same account, and a
 * permission check proves nothing if the "member" is actually the admin. Naming the role once, here,
 * makes those mistakes visible.
 *
 * ## Everything is a pointer, never a value
 *
 * `kpostIdEnv` and `passwordEnv` name environment variables; this file is committed and `.env` is
 * not. Beyond keeping secrets out of the repository, it lets a role be repointed at a different
 * account by editing `.env` alone.
 *
 * ## An unusable account resolves to a REASON, never a substitute
 *
 * Falling back to another account would let a two-party flow run with one party, or a permission
 * test run as the admin it was meant to be denied as — and still report PASS. `requireAccount()`
 * returns the reason and the caller skips.
 */

const AccountSchema = z.object({
  id: z.string().min(1),
  /** Environment variable holding this role's KPost ID. */
  kpostIdEnv: z.string().min(1),
  passwordEnv: z.string().min(1),
  userType: z.enum(['PERSONAL', 'BUSINESS_S', 'BUSINESS_M', 'BUSINESS_L']),
  companyIdEnv: z.string().optional(),
  /**
   * A PERSONAL account on the BUSINESS domain — pre-existing data from before the split. Declared
   * per account so the mismatch is a stated exception rather than a silent tolerance.
   */
  legacyDomain: z.boolean().optional(),
  /**
   * Whether the bench can hold a SESSION as this account.
   *
   * `false` means the account exists and can be acted upon, but its password is not ours — so it is
   * a permission SUBJECT, never a caller. Admin checks act on a member by `kpostID`, which needs no
   * session at all, and stating that explicitly stops a spec from assuming it can log in and then
   * failing with a credential error that looks like a product defect.
   */
  sessionCapable: z.boolean().optional(),
  purpose: z.string().min(1),
  provisioned: z.boolean(),
  provisionedAt: z.string().nullable().optional(),
});

/** The account tiers KPost recognises; the domain policy is keyed by these. */
export type KpostUserType = z.infer<typeof AccountSchema>['userType'];

const RegistrySchema = z.object({
  domainPolicy: z.object({
    PERSONAL: z.string().min(1),
    BUSINESS_S: z.string().min(1),
    BUSINESS_M: z.string().min(1),
    BUSINESS_L: z.string().min(1),
  }),
  accounts: z.array(AccountSchema).min(1),
});

export type TestAccount = z.infer<typeof AccountSchema>;

const parsed = RegistrySchema.safeParse(registry);
if (!parsed.success) {
  throw new Error(`src/fixtures/test-accounts.json is invalid:\n${z.prettifyError(parsed.error)}`);
}

const policy = parsed.data.domainPolicy;
export const TEST_ACCOUNTS: readonly TestAccount[] = parsed.data.accounts;

/**
 * The e-mail domain KPost routes a user type to.
 *
 * The product decides this, not the user: the signup screen binds the domain from the selected
 * account type rather than accepting one (`tests/e2e/signup-domain.spec.ts`).
 */
export function domainFor(userType: KpostUserType): string {
  return policy[userType];
}

/** The domain part of a KPost ID, lower-cased. */
export function domainOf(kpostId: string): string {
  return kpostId.slice(kpostId.lastIndexOf('@') + 1).toLowerCase();
}

/** This role's KPost ID from the environment, or undefined when the variable is unset. */
export function kpostIdOf(account: TestAccount): string | undefined {
  const value = process.env[account.kpostIdEnv];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * Why this id does not satisfy the domain policy, or undefined when it does.
 *
 * A `legacyDomain` account is exempt: a personal account on `@kpost.in` is pre-existing data, not a
 * defect, and rewriting a `kpost_id` would be a primary-key change across ~90 tables. The exemption
 * is declared per account in the registry, so it cannot be applied by accident.
 */
export function policyViolation(
  kpostId: string,
  userType: KpostUserType,
  legacyDomain = false,
): string | undefined {
  const expected = domainFor(userType);
  const actual = domainOf(kpostId);
  if (actual === expected) return undefined;
  if (legacyDomain) return undefined;
  return `${userType} accounts belong on @${expected}, but "${kpostId}" is on @${actual}`;
}

/** A resolved, usable account. */
export interface ResolvedAccount {
  id: string;
  kpostId: string;
  password: string;
  userType: KpostUserType;
  companyId?: string;
  legacyDomain: boolean;
  /** False when the bench holds no password: the account is a subject, never a caller. */
  sessionCapable: boolean;
}

export type AccountResolution =
  { ok: true; account: ResolvedAccount } | { ok: false; reason: string };

export function findAccount(id: string): TestAccount | undefined {
  return TEST_ACCOUNTS.find((account) => account.id === id);
}

/** The account for `id`, or the reason it cannot be used. */
export function requireAccount(id: string): AccountResolution {
  const account = findAccount(id);
  if (!account) {
    return { ok: false, reason: `no account "${id}" in src/fixtures/test-accounts.json` };
  }
  if (!account.provisioned) {
    return { ok: false, reason: `the "${account.id}" account is not marked provisioned` };
  }
  const kpostId = kpostIdOf(account);
  if (!kpostId) {
    return { ok: false, reason: `${account.kpostIdEnv} is not set, so "${account.id}" has no id` };
  }
  const violation = policyViolation(kpostId, account.userType, account.legacyDomain);
  if (violation) return { ok: false, reason: violation };

  /*
   * A subject-only account needs no password: nothing logs in as it. Demanding one would make the
   * Admin permission flows unresolvable for the very members they are supposed to act on.
   */
  const sessionCapable = account.sessionCapable ?? true;
  const password = process.env[account.passwordEnv];
  if (sessionCapable && !password) {
    return {
      ok: false,
      reason: `${account.passwordEnv} is not set, so "${kpostId}" has no password`,
    };
  }
  const companyId = account.companyIdEnv ? process.env[account.companyIdEnv] : undefined;
  if (account.companyIdEnv && !companyId) {
    return { ok: false, reason: `${account.companyIdEnv} is not set for "${kpostId}"` };
  }
  return {
    ok: true,
    account: {
      id: account.id,
      kpostId,
      password: password ?? '',
      sessionCapable,
      userType: account.userType,
      legacyDomain: account.legacyDomain ?? false,
      ...(companyId ? { companyId } : {}),
    },
  };
}

/** Every account a spec needs at once, so one skip reason covers the whole flow. */
export function requireAccounts(...ids: string[]): AccountResolution[] {
  return ids.map(requireAccount);
}

/** The first blocking reason among `resolutions`, or undefined when all are usable. */
export function blockingReason(resolutions: readonly AccountResolution[]): string | undefined {
  for (const resolution of resolutions) if (!resolution.ok) return resolution.reason;
  return undefined;
}

/**
 * Resolves every id, returning either all the accounts or the first reason one is unusable.
 *
 * All-or-nothing, because a multi-account flow missing one account is not a partial test — it is a
 * different test.
 */
export function requireAll(
  ...ids: string[]
): { ok: true; accounts: ResolvedAccount[] } | { ok: false; reason: string } {
  const resolutions = requireAccounts(...ids);
  const reason = blockingReason(resolutions);
  if (reason) return { ok: false, reason };
  return { ok: true, accounts: resolutions.flatMap((r) => (r.ok ? [r.account] : [])) };
}

/** Every configured KPost ID, for the QA-identifier guard's owned-value allowlist. */
export function allRegisteredKpostIds(): string[] {
  return TEST_ACCOUNTS.flatMap((account) => {
    const id = kpostIdOf(account);
    return id ? [id] : [];
  });
}
