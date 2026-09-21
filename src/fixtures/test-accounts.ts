import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT_DIR } from '@config/constants';
import registry from './test-accounts.json' with { type: 'json' };

/**
 * The single source of truth for which accounts the bench uses.
 *
 * ## Why a registry rather than `.env` values scattered through specs
 *
 * Accounts were previously named directly in `testData` and reached for by whichever spec needed
 * one, so "which account does this test act as?" could only be answered by reading the test. That
 * matters more than tidiness: a flow that sends between two accounts is meaningless if both ends
 * turn out to be the same account, and a permission check proves nothing if the "member" is
 * actually the admin. Naming the role once, here, makes those mistakes visible.
 *
 * ## Passwords are pointers, never values
 *
 * `test-accounts.json` is committed. A password written into it would be in the git history
 * permanently and could not be rotated by redeploying, so the file carries `passwordEnv` — the NAME
 * of an environment variable — and the secret itself stays in `.env`, which is git-ignored. This is
 * the same rule the rest of the bench follows for the Bugzilla key and the database credentials.
 *
 * ## An unprovisioned account is SKIPPED, never substituted
 *
 * `provisioned: false` means the account does not exist on the target. `requireAccount()` then
 * returns a reason instead of a credential, and the caller skips. It deliberately does NOT fall
 * back to another account: a test that quietly runs as somebody else still reports PASS, and that
 * result is worse than no result — it is a false claim of coverage on exactly the flows (sender vs
 * receiver, admin vs member) where identity is the thing under test.
 */

const AccountSchema = z.object({
  id: z.string().min(1),
  kpostId: z.string().min(3),
  passwordEnv: z.string().min(1),
  userType: z.enum(['PERSONAL', 'BUSINESS_S', 'BUSINESS_M', 'BUSINESS_L']),
  companyIdEnv: z.string().optional(),
  purpose: z.string().min(1),
  provisioned: z.boolean(),
  provisionedAt: z.string().nullable(),
});

/** The account tiers KPost recognises; the domain policy is keyed by these. */
export type KpostUserType = z.infer<typeof AccountSchema>['userType'];

const RegistrySchema = z.object({
  domainPolicy: z.object({
    PERSONAL: z.string().min(1),
    BUSINESS_S: z.string().min(1),
    BUSINESS_M: z.string().min(1),
    BUSINESS_L: z.string().min(1),
    prefix: z.string().min(1),
    identifierPattern: z.string().min(1),
  }),
  accounts: z.array(AccountSchema).min(1),
});

export type TestAccount = z.infer<typeof AccountSchema>;

const parsed = RegistrySchema.safeParse(registry);
if (!parsed.success) {
  throw new Error(`src/fixtures/test-accounts.json is invalid:\n${z.prettifyError(parsed.error)}`);
}

const policy = parsed.data.domainPolicy;

export const ACCOUNT_PREFIX = policy.prefix;
export const IDENTIFIER_PATTERN = new RegExp(policy.identifierPattern);
export const TEST_ACCOUNTS: readonly TestAccount[] = parsed.data.accounts;

/**
 * The e-mail domain KPost routes a user type to.
 *
 * The product decides this, not the user: the signup screen binds the domain from the selected
 * account type rather than accepting one. Mirroring that here is what stops the bench from creating
 * an account the product would never have produced — and a personal account on the business domain
 * would exercise a routing path no real signup can reach.
 */
export function domainFor(userType: KpostUserType): string {
  return policy[userType];
}

/**
 * A compliant KPost ID for a bench-owned account.
 *
 * `qatest_` + identifier + the domain the type mandates. Used by the account registry, by signup
 * helpers and by the UI spec, so all three agree by construction rather than by three people
 * remembering the same rule.
 */
export function qatestId(identifier: string, userType: KpostUserType): string {
  const normalized = identifier.trim().toLowerCase();
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(
      `"${identifier}" is not a usable account identifier: it must match ${String(IDENTIFIER_PATTERN)}`,
    );
  }
  return `${ACCOUNT_PREFIX}${normalized}@${domainFor(userType)}`;
}

/** The domain part of a KPost ID, lower-cased. */
export function domainOf(kpostId: string): string {
  return kpostId.slice(kpostId.lastIndexOf('@') + 1).toLowerCase();
}

/**
 * Why this id does not satisfy the naming + domain policy, or undefined when it does.
 *
 * Returns a reason rather than a boolean because every caller — the registry loader, the framework
 * test, `recordProvisionedAccount` — needs to say *what* is wrong, and "false" cannot.
 */
export function policyViolation(kpostId: string, userType: KpostUserType): string | undefined {
  const local = kpostId.slice(0, kpostId.lastIndexOf('@'));
  if (!local.startsWith(ACCOUNT_PREFIX)) {
    return `"${kpostId}" must start with "${ACCOUNT_PREFIX}" so the bench's own accounts are identifiable`;
  }
  if (!IDENTIFIER_PATTERN.test(local.slice(ACCOUNT_PREFIX.length))) {
    return `"${kpostId}" has an identifier that does not match ${String(IDENTIFIER_PATTERN)}`;
  }
  const expected = domainFor(userType);
  const actual = domainOf(kpostId);
  if (actual !== expected) {
    return `${userType} accounts must be on @${expected}, but "${kpostId}" is on @${actual}`;
  }
  return undefined;
}

/** Registry ids, so a caller asking for a name that does not exist fails at the type level. */
export type TestAccountId = (typeof TEST_ACCOUNTS)[number]['id'];

/** A resolved, usable account: it exists on the target and its password is in the environment. */
export interface ResolvedAccount {
  id: string;
  kpostId: string;
  password: string;
  userType: TestAccount['userType'];
  companyId?: string;
}

export type AccountResolution =
  { ok: true; account: ResolvedAccount } | { ok: false; reason: string };

export function findAccount(id: string): TestAccount | undefined {
  return TEST_ACCOUNTS.find((account) => account.id === id);
}

/**
 * The account for `id`, or the reason it cannot be used.
 *
 * Returns a reason rather than throwing because the caller's correct response is to SKIP with that
 * reason attached — an unprovisioned account is a gap in the environment, not a defect in the
 * product, and failing the test would file a bug against the wrong thing.
 */
export function requireAccount(id: string): AccountResolution {
  const account = findAccount(id);
  if (!account) {
    return { ok: false, reason: `no account "${id}" in src/fixtures/test-accounts.json` };
  }
  const violation = policyViolation(account.kpostId, account.userType);
  if (violation) return { ok: false, reason: violation };
  if (!account.provisioned) {
    return {
      ok: false,
      reason:
        `the account "${account.kpostId}" (${account.id}) has not been provisioned on this target — ` +
        `create it, then set provisioned: true in src/fixtures/test-accounts.json`,
    };
  }
  const password = process.env[account.passwordEnv];
  if (!password) {
    return {
      ok: false,
      reason: `${account.passwordEnv} is not set, so "${account.kpostId}" has no usable password`,
    };
  }
  const companyId = account.companyIdEnv ? process.env[account.companyIdEnv] : undefined;
  if (account.companyIdEnv && !companyId) {
    return { ok: false, reason: `${account.companyIdEnv} is not set for "${account.kpostId}"` };
  }
  return {
    ok: true,
    account: {
      id: account.id,
      kpostId: account.kpostId,
      password,
      userType: account.userType,
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
 * The all-or-nothing shape is what a multi-account flow needs: sending between two accounts with
 * only one of them available is not a partial test, it is a different test.
 */
export function requireAll(
  ...ids: string[]
): { ok: true; accounts: ResolvedAccount[] } | { ok: false; reason: string } {
  const resolutions = requireAccounts(...ids);
  const reason = blockingReason(resolutions);
  if (reason) return { ok: false, reason };
  return { ok: true, accounts: resolutions.flatMap((r) => (r.ok ? [r.account] : [])) };
}

const REGISTRY_PATH = path.join(ROOT_DIR, 'src', 'fixtures', 'test-accounts.json');

/**
 * Records an account the bench created at runtime, so the next run reuses it instead of creating
 * another.
 *
 * Append-only and idempotent by `kpostId`: re-running a setup that already provisioned its account
 * must not add a second entry, or the registry becomes a log rather than a registry. It writes the
 * id and metadata only — the password still goes to the environment, and the function says so in
 * its return value rather than storing it.
 *
 * Refuses any id that breaks the naming convention: an account the bench cannot recognise as its
 * own is one the QA-identifier guard will later refuse to send requests for, so accepting it here
 * would only move the failure somewhere less obvious.
 */
export function recordProvisionedAccount(entry: {
  id: string;
  kpostId: string;
  passwordEnv: string;
  userType: TestAccount['userType'];
  purpose: string;
  companyIdEnv?: string;
}): { ok: true; added: boolean } | { ok: false; reason: string } {
  const violation = policyViolation(entry.kpostId, entry.userType);
  if (violation) return { ok: false, reason: `refusing to record it: ${violation}` };

  const raw: unknown = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const file = raw as { accounts: TestAccount[] } & Record<string, unknown>;

  const existing = file.accounts.find((account) => account.kpostId === entry.kpostId);
  if (existing) {
    // Already known: mark it live rather than appending a duplicate.
    existing.provisioned = true;
    existing.provisionedAt ??= new Date().toISOString();
    fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    return { ok: true, added: false };
  }

  file.accounts.push({
    id: entry.id,
    kpostId: entry.kpostId,
    passwordEnv: entry.passwordEnv,
    userType: entry.userType,
    ...(entry.companyIdEnv ? { companyIdEnv: entry.companyIdEnv } : {}),
    purpose: entry.purpose,
    provisioned: true,
    provisionedAt: new Date().toISOString(),
  });
  fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  return { ok: true, added: true };
}
