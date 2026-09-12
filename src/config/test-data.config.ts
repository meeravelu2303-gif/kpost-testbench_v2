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

  /** An account that does not exist — the "not found" path, and the enumeration probe. */
  kpostIdAbsent: z.string().min(3).default('no.such.user.9f2a@kpost.in'),

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
  kpostIdAbsent: 'QA_KPOST_ID_ABSENT',
  mobileExists: 'QA_MOBILE_EXISTS',
  mobileAbsent: 'QA_MOBILE_ABSENT',
  companyId: 'QA_COMPANY_ID',
  companyName: 'QA_COMPANY_NAME',
  companyNameAbsent: 'QA_COMPANY_NAME_ABSENT',
  uniqueName: 'QA_UNIQUE_NAME',
  domain: 'QA_DOMAIN',
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

export const testData = parsed.data;
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
