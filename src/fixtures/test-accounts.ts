import { z } from 'zod';
import registry from './test-accounts.json' with { type: 'json' };

/**
 * The registry of which accounts the bench uses, by role. Entries name `.env` variables, never
 * values. An unusable account resolves to a reason (the caller skips), never a substitute that
 * could fake a PASS.
 */

const AccountSchema = z.object({
  id: z.string().min(1),
  /** Environment variable holding this role's KPost ID. */
  kpostIdEnv: z.string().min(1),
  passwordEnv: z.string().min(1),
  userType: z.enum(['PERSONAL', 'BUSINESS_S', 'BUSINESS_M', 'BUSINESS_L']),
  companyIdEnv: z.string().optional(),
  /** A PERSONAL account on the business domain (pre-existing data), declared as an exception. */
  legacyDomain: z.boolean().optional(),
  /**
   * `false`: we do not hold the password, so the account is only acted upon, never logged in as.
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

/** The e-mail domain KPost assigns to a user type (the product decides, not the user). */
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

/** Why this id breaks the domain policy, or undefined. `legacyDomain` accounts are exempt. */
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

  // A subject-only account needs no password: nothing logs in as it.
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

/** All the accounts, or the first reason one is unusable (missing one makes a different test). */
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
