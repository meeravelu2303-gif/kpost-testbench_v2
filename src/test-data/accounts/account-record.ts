/**
 * The record of an account the BENCH created, and its Test-Bench lifecycle.
 *
 * ## What this is not
 *
 * Not a credential store, not a second account pool, and not application state. It is persistent
 * KNOWLEDGE about accounts automation made: which ones exist, on which environment, and whether they
 * are still usable. Credentials stay where they already live — `AccountPool` over configured
 * principals — and this registry never holds one.
 *
 * ## Why a separate lifecycle
 *
 * `TestAccountStatus` describes the BENCH's relationship with an account. It is deliberately not any
 * of the vocabularies the repository already has, all of which mean different things:
 *
 *     ResourceState      REGISTERED · CLEANUP_PENDING · CLEANED · CLEANUP_FAILED   (one run's cleanup)
 *     FlowStepStatus     NOT_EXECUTED · BLOCKED · SKIPPED · PASSED · FAILED        (did a step run)
 *     ValidationStatus   PASSED · FAILED · SKIPPED · WARNING                       (did a check pass)
 *     katchupStatus      Sent · Unread · Read …                                    (the application)
 *
 * `CLEANUP_PENDING`/`CLEANED` appear in two of those lists and mean different things in each: in the
 * ledger they describe ONE RUN's tidy-up of a resource; here they describe whether the account itself
 * has been disposed of. A guard asserts the two are never conflated.
 */

/**
 * The Test Bench's relationship with an account.
 *
 *     CREATED ──► ACTIVE ──┬─► LOCKED ──► ACTIVE | DISABLED | RETIRED
 *                          ├─► DISABLED ─► RETIRED | CLEANUP_PENDING
 *                          ├─► CLEANUP_PENDING ──► CLEANED
 *                          └─► RETIRED
 *
 *  - `CREATED`          signup succeeded; not yet used for anything.
 *  - `ACTIVE`           usable by automation.
 *  - `LOCKED`           temporarily unusable (the application locked it); may recover.
 *  - `DISABLED`         deliberately taken out of service; does not recover on its own.
 *  - `CLEANUP_PENDING`  deletion has been attempted or is intended.
 *  - `CLEANED`          the account is gone from the application. Terminal.
 *  - `RETIRED`          the bench will not use it again, but it still EXISTS. Terminal.
 *
 * `RETIRED` and `CLEANED` are separate on purpose, and the distinction is load-bearing here: KPOST
 * offers no way to delete a signup account, so an account the bench finishes with can only ever be
 * retired. Collapsing them would claim a deletion that never happened.
 */
export const TEST_ACCOUNT_STATUSES = [
  'CREATED',
  'ACTIVE',
  'LOCKED',
  'DISABLED',
  'CLEANUP_PENDING',
  'CLEANED',
  'RETIRED',
] as const;
export type TestAccountStatus = (typeof TEST_ACCOUNT_STATUSES)[number];

export function isTestAccountStatus(value: unknown): value is TestAccountStatus {
  return typeof value === 'string' && (TEST_ACCOUNT_STATUSES as readonly string[]).includes(value);
}

/** The legal transitions. Centralised so no caller can invent one. */
const ALLOWED: Readonly<Record<TestAccountStatus, readonly TestAccountStatus[]>> = {
  CREATED: ['ACTIVE', 'LOCKED', 'DISABLED', 'CLEANUP_PENDING', 'RETIRED'],
  ACTIVE: ['LOCKED', 'DISABLED', 'CLEANUP_PENDING', 'RETIRED'],
  LOCKED: ['ACTIVE', 'DISABLED', 'CLEANUP_PENDING', 'RETIRED'],
  DISABLED: ['CLEANUP_PENDING', 'RETIRED'],
  CLEANUP_PENDING: ['CLEANED', 'RETIRED'],
  CLEANED: [],
  RETIRED: [],
};

export function canTransition(from: TestAccountStatus, to: TestAccountStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function allowedTransitionsFrom(status: TestAccountStatus): readonly TestAccountStatus[] {
  return ALLOWED[status] ?? [];
}

/** How the bench came to know about the account. */
export const ACCOUNT_SOURCES = [
  /** Created by the bench through the signup flow. */
  'signup',
  /** Provisioned by an administrator through the admin module. */
  'admin-provisioned',
  /** Configured by a human in `.env` — the existing pool accounts. Recorded, never created here. */
  'configured',
] as const;
export type AccountSource = (typeof ACCOUNT_SOURCES)[number];

/**
 * An account the bench knows about.
 *
 * Field names follow the repository's existing KPOST terminology (`kpostId`, `userType`) rather than
 * generic ones, so nothing has to be translated at the point of use. Anything the application does
 * not reliably give back is OPTIONAL rather than filled with a plausible value.
 */
export interface TestAccountRecord {
  /** Bench-minted, stable, and unique within the registry. Never a KPOST value. */
  readonly accountId: string;
  /**
   * THE KPOST identity. On this product a personal account's id is an e-mail-shaped string on the
   * product's own domain, so it doubles as the address — which is why there is no separate
   * `username`: inventing one would imply a field KPOST does not have.
   */
  readonly kpostId: string;
  /** A contact address, when signup used one distinct from `kpostId`. */
  readonly email?: string;
  /** The account tier, in the repository's own vocabulary: `PERSONAL`, `BUSINESS_S|M|L`. */
  readonly userType?: string;
  /** The role vocabulary the auth config already uses (`USER`, `COMPANY_ADMIN`). */
  readonly role?: string;
  /** Which deployment it exists on. An account is only ever valid on its own environment. */
  readonly environment: string;
  readonly status: TestAccountStatus;
  readonly createdAt: string;
  /** Always the bench for a record this module creates. */
  readonly createdBy: string;
  /** Which flow made it, e.g. `otp-signup-personal`. */
  readonly signupFlowId?: string;
  /**
   * Whether account creation was CONFIRMED by application evidence rather than an HTTP code.
   * `false` means the account is recorded but unconfirmed, and must not be reused.
   */
  readonly verified: boolean;
  /** How the evidence was obtained, so a reviewer can check the claim. */
  readonly verificationNote?: string;
  readonly source: AccountSource;
  readonly lastUsedAt?: string;
  readonly usageCount: number;
  readonly retiredAt?: string;
  /** Why it was retired or disabled. */
  readonly statusReason?: string;
}

/**
 * Keys that must NEVER be persisted. Enforced at the write boundary, not left to review.
 *
 * The registry's whole safety story is that it holds identity and nothing else: an account id is
 * enough to ask the existing credential provider for a token, so a secret here would buy nothing and
 * risk everything. Lower-cased comparison, because a payload may spell it any way.
 */
export const FORBIDDEN_ACCOUNT_KEYS = [
  'password',
  'passwordhash',
  'pwd',
  'secret',
  'accesstoken',
  'refreshtoken',
  'token',
  'sessioncookie',
  'cookie',
  'authorization',
  'apikey',
  'api_key',
  'otp',
  'verificationcode',
  'credential',
  'credentials',
] as const;

export class TestAccountError extends Error {
  override readonly name = 'TestAccountError';
}

/**
 * Refuses a record carrying anything secret-shaped.
 *
 * Throws rather than stripping: a caller that tried to persist a credential has a bug worth seeing,
 * and silently dropping the field would let the same call site keep doing it.
 */
export function assertNoSecrets(record: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(record)) {
    const normalised = key.toLowerCase().replace(/[-_]/g, '');
    const hit = FORBIDDEN_ACCOUNT_KEYS.find(
      (forbidden) => normalised === forbidden.replace(/[-_]/g, ''),
    );
    if (hit) {
      throw new TestAccountError(
        `the account registry may not persist "${key}". It stores IDENTITY only — an accountId is ` +
          'enough to obtain credentials from the existing account pool, so a secret here would add ' +
          'nothing and risk everything.',
      );
    }
  }
}

/**
 * The identity two records must not share.
 *
 * `kpostId` is THE unique identity on this product — it is what `kpostIdExist` checks and what login
 * takes — and it is scoped by environment, because the same id on a different deployment is a
 * different account. `accountId` is checked separately by the registry.
 */
export function accountKey(record: Pick<TestAccountRecord, 'environment' | 'kpostId'>): string {
  return `${record.environment}|${record.kpostId.trim().toLowerCase()}`;
}
