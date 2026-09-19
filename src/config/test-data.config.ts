import { z } from 'zod';
import { env } from './env';

/**
 * Every environment-specific value the tests send, in one file, under the `QA_*` names used in
 * `.env`.
 *
 * ## Why it is all here
 *
 * A test that hard-codes `meera960@kpostindia.com` is a test that works on one host. When the QA
 * database is reseeded or the suite is pointed at staging, the failures look like API defects and
 * someone spends an afternoon proving otherwise. So no spec and no endpoint definition contains a
 * literal identifier: they read from here, and this reads from the environment.
 *
 * ## Defaults are the mock server's seed, deliberately
 *
 * With nothing configured the whole suite still runs, against `mock-server/`. That is what makes
 * the tests reviewable before the environment is reachable — but it also means a default value
 * silently standing in for a real one would be dangerous, so `unconfirmed()` lists exactly which
 * values are still placeholders and `describeTestData()` surfaces that on every non-mock run.
 *
 * ## The accounts are real
 *
 * `QA_KPOST_ID` and friends are live accounts on 192.168.0.66 with real passwords. Two
 * consequences the tests respect:
 *
 *  - Nothing here is ever logged: the masking in `src/utils/mask.ts` covers password fields, and
 *    request bodies in reports are masked before they reach a Bugzilla ticket.
 *  - **`forgotPassword` rewrites an account's password.** Pointing it at `QA_KPOST_ID` would
 *    invalidate the credential every other suite logs in with, so it has its own
 *    `QA_FORGOT_PASSWORD_KPOST_ID` and stays behind `ALLOW_DESTRUCTIVE_TESTS`.
 */
const schema = z.object({
  /** The primary QA account — a PERSONAL user that exists in the target database. */
  kpostId: z.string().min(3).default('qa.bench@kpost.in'),
  password: z.string().min(1).default('mock-password'),
  userType: z.string().min(1).default('PERSONAL'),
  countryId: z.coerce.number().int().positive().default(1),

  /**
   * The four KPost user types, each a real account on the target host. KPost has exactly these
   * (confirmed by the API owner): PERSONAL, and BUSINESS_S / _M / _L for Small, Medium and Large.
   * There is no separate "admin" type - a business account administers its own company.
   */
  businessSKpostId: z.string().min(3).default('qa.business.s@kpost.in'),
  businessMKpostId: z.string().min(3).default('qa.business.m@kpost.in'),
  businessLKpostId: z.string().min(3).default('qa.business.l@kpost.in'),

  /** Business-tier administrator, for the company and admin-facing lookups. */
  adminKpostId: z.string().min(3).default('qa.admin@kpost.in'),
  adminPassword: z.string().min(1).default('mock-password'),
  adminUserType: z.string().min(1).default('BUSINESS_S'),

  /**
   * A second real account that owns data the primary account must not see. The cross-resource
   * validators use it to prove an endpoint enforces ownership rather than trusting an id.
   */
  victimKpostId: z.string().min(3).default('qa.victim@kpost.in'),
  businessReceiverKpostId: z.string().min(3).default('qa.receiver@kpost.in'),

  /**
   * Extra PERSONAL accounts for group messaging, Copy/Confidential-Copy and multi-recipient tests.
   * Six real accounts exist on live; these are 3-6 (1 is `kpostId`, 2 is `victimKpostId`).
   */
  personal3KpostId: z.string().min(3).default('qa.p3@kpost.in'),
  personal4KpostId: z.string().min(3).default('qa.p4@kpost.in'),
  personal5KpostId: z.string().min(3).default('qa.p5@kpost.in'),
  personal6KpostId: z.string().min(3).default('qa.p6@kpost.in'),

  /** An account that does not exist — the "not found" path, and the enumeration probe. */
  kpostIdAbsent: z.string().min(3).default('no.such.user.9f2a@kpost.in'),

  /**
   * A KPost ID + mobile reserved for REGISTRATION on the disposable test DB (OTP_TEST_GATEWAY). Kept
   * separate from `kpostIdAbsent` so a signup does not make the enumeration read ("is it available?")
   * see it as taken. Allowlisted by the QA-identifier guard. On a fresh/reset test DB a signup
   * succeeds; on a re-run it is "already exists" (BR-SL / BR-S02) — both are valid assertions.
   */
  signupKpostId: z.string().min(3).default('qabench.signup@kpost.in'),
  signupMobile: z.string().min(6).default('9000000777'),

  /** A mobile number that IS registered. */
  mobileExists: z.string().min(6).default('9000000949'),
  /** A mobile number that is NOT registered. */
  mobileAbsent: z.string().min(6).default('9000000001'),

  /** Company identity, derived from the admin account's address. */
  companyId: z.coerce.number().int().positive().default(1),
  companyName: z.string().min(1).default('QA Bench Company'),
  companyNameAbsent: z.string().min(1).default('Nonexistent QA Company 9f2a'),
  uniqueName: z.string().min(1).default('qabench'),
  domain: z.string().min(1).default('kpost.in'),

  /**
   * The Admin module (`admin-api`) is driven by the BUSINESS_M/L admins; every admin payload carries
   * the caller's own `companyId`, which is the `companyID` claim in the business-admin login token.
   * Discovered on the first live login (decode the token) and set here so the guard allowlists it.
   * Defaults are placeholders — unset on live means the value is not allowlisted and any admin call
   * naming a company is refused, the same self-enforcing scope the personal accounts use.
   */
  businessSCompanyId: z.coerce.number().int().positive().default(1),
  businessMCompanyId: z.coerce.number().int().positive().default(1),
  businessLCompanyId: z.coerce.number().int().positive().default(1),

  /** BUSINESS_M company members (of company 1067), for employee/role-posting reads and writes. */
  businessMUser1KpostId: z.string().min(3).default('qa.m.user1@kpost.in'),
  businessMUser2KpostId: z.string().min(3).default('qa.m.user2@kpost.in'),
  /** The BUSINESS_M admin's registered mobile — resolves company 1067 in the company-lookup reads. */
  businessMMobile: z.string().min(6).default('9000000004'),

  /** Location ids for the states/cities/postcode lookups. */
  stateId: z.coerce.number().int().positive().default(1),
  regionId: z.coerce.number().int().positive().default(1),
  pinCode: z.string().min(4).default('600001'),

  /**
   * Throwaway destinations for the OTP endpoints: these receive real SMS and real email on a live
   * host, so they must never be a customer's or a colleague's address.
   */
  otpMobile: z.string().min(6).default('9000000002'),
  otpEmail: z.string().email().default('qa.bench+otp@kpost.in'),
  /** An OTP that is certainly wrong, for the rejection path. */
  invalidOtp: z.string().min(4).default('000000'),
  /**
   * The developer bypass OTP for this environment: it always validates. It makes the happy path
   * testable without reading the code that was sent - and is itself worth a hard look, because an
   * OTP that always works is an account-takeover key if it ever reaches production.
   */
  bypassOtp: z.string().min(4).default('123456'),

  /**
   * The account whose password the forgot-password flow may rewrite. Never the login account.
   * Defaults to a value that does not exist, so an unconfigured run cannot change anything real.
   */
  forgotPasswordKpostId: z.string().min(3).default('no.such.user.9f2a@kpost.in'),

  /** Product id, documented as a 24-character object id rather than the numeric product id. */
  productObjectId: z.string().min(8).default('68932118deea0f15c8893429'),
  /** Module code from the types contract (KPOST_MODULE). */
  moduleId: z.coerce.number().int().nonnegative().default(1),
});

/** Environment variable per field — the names used in `.env`. */
const SOURCES = {
  kpostId: 'QA_KPOST_ID',
  password: 'QA_PASSWORD',
  userType: 'QA_USER_TYPE',
  countryId: 'QA_COUNTRY_ID',
  businessSKpostId: 'QA_BUSINESS_S_KPOST_ID',
  businessMKpostId: 'QA_BUSINESS_M_KPOST_ID',
  businessLKpostId: 'QA_BUSINESS_L_KPOST_ID',
  adminKpostId: 'QA_ADMIN_KPOST_ID',
  adminPassword: 'QA_ADMIN_PASSWORD',
  adminUserType: 'QA_ADMIN_USER_TYPE',
  victimKpostId: 'QA_VICTIM_KPOST_ID',
  businessReceiverKpostId: 'QA_BUSINESS_RECEIVER_KPOST_ID',
  personal3KpostId: 'QA_PERSONAL_3_KPOST_ID',
  personal4KpostId: 'QA_PERSONAL_4_KPOST_ID',
  personal5KpostId: 'QA_PERSONAL_5_KPOST_ID',
  personal6KpostId: 'QA_PERSONAL_6_KPOST_ID',
  kpostIdAbsent: 'QA_KPOST_ID_ABSENT',
  signupKpostId: 'QA_SIGNUP_KPOST_ID',
  signupMobile: 'QA_SIGNUP_MOBILE',
  mobileExists: 'QA_MOBILE_EXISTS',
  mobileAbsent: 'QA_MOBILE_ABSENT',
  companyId: 'QA_COMPANY_ID',
  companyName: 'QA_COMPANY_NAME',
  companyNameAbsent: 'QA_COMPANY_NAME_ABSENT',
  uniqueName: 'QA_UNIQUE_NAME',
  domain: 'QA_DOMAIN',
  businessSCompanyId: 'QA_BUSINESS_S_COMPANY_ID',
  businessMCompanyId: 'QA_BUSINESS_M_COMPANY_ID',
  businessLCompanyId: 'QA_BUSINESS_L_COMPANY_ID',
  businessMUser1KpostId: 'QA_BUSINESS_M_USER_1_KPOST_ID',
  businessMUser2KpostId: 'QA_BUSINESS_M_USER_2_KPOST_ID',
  businessMMobile: 'QA_BUSINESS_M_MOBILE',
  stateId: 'QA_STATE_ID',
  regionId: 'QA_REGION_ID',
  pinCode: 'QA_PINCODE',
  otpMobile: 'QA_OTP_MOBILE',
  otpEmail: 'QA_OTP_EMAIL',
  invalidOtp: 'QA_INVALID_OTP',
  bypassOtp: 'QA_BYPASS_OTP',
  forgotPasswordKpostId: 'QA_FORGOT_PASSWORD_KPOST_ID',
  productObjectId: 'QA_PRODUCT_OBJECT_ID',
  moduleId: 'QA_MODULE_ID',
} as const satisfies Record<keyof z.infer<typeof schema>, string>;

const provided = Object.fromEntries(
  Object.entries(SOURCES)
    .map(([field, variable]) => [field, process.env[variable]] as const)
    .filter(([, value]) => value !== undefined && value !== ''),
);

const parsed = schema.safeParse(provided);
if (!parsed.success) {
  throw new Error(`Invalid QA_* test data configuration:\n${z.prettifyError(parsed.error)}`);
}
// Narrowed once here: `parsed.data` inside a closure below would otherwise be possibly-undefined.
const resolved = parsed.data;

/**
 * Identifiers that name a record somebody could own. On the live application these must be
 * configured explicitly — a default is not allowed to stand in for one.
 *
 * ## Why this is a hard failure and not a warning
 *
 * Every value here is loaded into the QA-identifier guard's allowlist, which is the control that
 * stops a live request naming a record we do not own. The schema defaults were written for the
 * mock server's seed, and two of them are actively dangerous against live:
 *
 *     companyId  defaults to 1        <- company 1 is a REAL company on the live application
 *     kpostId    defaults to 'qa.bench@kpost.in'
 *
 * An unset `QA_COMPANY_ID` would therefore put `1` in the allowlist and tell the guard that a
 * stranger's company is ours to act on — turning the safety control into the thing that authorises
 * the damage. `describeTestData()` only *warns* about placeholders, which is right for a dev host
 * and nowhere near enough here.
 *
 * Values NOT listed: passwords and user types (not identifiers), reference data (`countryId`,
 * `stateId` — shared and read-only), and the `*Absent` fixtures, which are required to match
 * nothing and so cannot name anyone's record.
 */
const IDENTITY_FIELDS = [
  'kpostId',
  'victimKpostId',
  'personal3KpostId',
  'personal4KpostId',
  'personal5KpostId',
  'personal6KpostId',
  'adminKpostId',
  'businessSKpostId',
  'businessMKpostId',
  'businessLKpostId',
  'businessReceiverKpostId',
  'forgotPasswordKpostId',
  'mobileExists',
  'otpMobile',
  'otpEmail',
  'companyId',
  'companyName',
  'companyNameAbsent',
  'uniqueName',
  'businessSCompanyId',
  'businessMCompanyId',
  'businessLCompanyId',
  'businessMUser1KpostId',
  'businessMUser2KpostId',
  'businessMMobile',
] as const satisfies readonly (keyof z.infer<typeof schema>)[];

/**
 * Identity values that were set **explicitly** in `.env`, never a schema default.
 *
 * This is what the QA-identifier guard allowlists, and the distinction is the whole point: an
 * unset identifier is **absent** from the allowlist rather than defaulted into it. So while no
 * business account exists on live, `QA_COMPANY_ID` is unset, `1` never enters the allowlist, and
 * any request naming a company is refused before it is sent. The scope enforces itself — nobody
 * has to remember to keep business endpoints out of a PERSONAL-only run.
 *
 * `testData` keeps its defaults so the mock-backed suites still run with nothing configured.
 */
export function providedIdentityValues(): string[] {
  return IDENTITY_FIELDS.filter((field) => field in provided).map((field) =>
    String(resolved[field]),
  );
}

/** True when `field` was set explicitly in `.env` rather than falling back to a mock default. */
export function isProvided(field: keyof TestData): boolean {
  return field in provided;
}

/**
 * The six PERSONAL account ids, in order. For group, Copy/Confidential-Copy and multi-recipient
 * tests, which need several real accounts we own. On live all six are configured; off-live these are
 * mock defaults.
 */
export const PERSONAL_ACCOUNTS: readonly string[] = [
  resolved.kpostId,
  resolved.victimKpostId,
  resolved.personal3KpostId,
  resolved.personal4KpostId,
  resolved.personal5KpostId,
  resolved.personal6KpostId,
];

/** `QA_*` names for identity values still falling back to a mock default. */
export function defaultedIdentityFields(): string[] {
  return IDENTITY_FIELDS.filter((field) => !(field in provided)).map((field) => SOURCES[field]);
}

/*
 * Without a primary account nothing can authenticate, and every endpoint that needs a token would
 * report 401 — a configuration mistake dressed up as an API defect, which is the failure this
 * bench exists to avoid producing. Only the two values that make a run possible at all are
 * required; the rest are allowed to be absent, because absence is safe by the design above.
 */
if (env.IS_PRODUCTION && !('kpostId' in provided)) {
  throw new Error(
    'QA_KPOST_ID must be set explicitly for a live run: the default is a mock value that does ' +
      'not exist on the live application, and every authenticated endpoint would report 401.',
  );
}

export const testData = resolved;
export type TestData = typeof testData;

/**
 * Values that are still mock defaults, as `QA_*` names.
 *
 * Anything listed here is a value the tests will send that nobody has confirmed exists in the
 * target database — so a "not found" result may be the test data rather than a defect.
 */
export function unconfirmed(): string[] {
  return Object.entries(SOURCES)
    .filter(([field]) => !(field in provided))
    .map(([, variable]) => variable);
}

/** A warning for a run against a real host that is still using placeholder data. */
export function describeTestData(): string | undefined {
  if (env.MOCK_API) return undefined;
  const missing = unconfirmed();
  if (!missing.length) return undefined;
  return (
    `${missing.length} test-data values are still placeholders and may not exist in this ` +
    `environment: ${missing.join(', ')}`
  );
}
