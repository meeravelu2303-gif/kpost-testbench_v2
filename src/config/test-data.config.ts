import { z } from 'zod';
import { env } from './env';

/**
 * Every environment-specific value the tests send, read from the `QA_*` variables in `.env`, so no
 * spec hard-codes an identifier. Defaults are placeholders; `unconfirmed()` lists the ones still in
 * use.
 */
const schema = z.object({
  /** The primary QA account, a PERSONAL user in the target database. */
  kpostId: z.string().min(3).default('qa.bench@kpost.in'),
  password: z.string().min(1).default('mock-password'),
  userType: z.string().min(1).default('PERSONAL'),
  countryId: z.coerce.number().int().positive().default(1),

  /** Business Small / Medium / Large accounts; each administers its own company. */
  businessSKpostId: z.string().min(3).default('qa.business.s@kpost.in'),
  businessMKpostId: z.string().min(3).default('qa.business.m@kpost.in'),
  businessLKpostId: z.string().min(3).default('qa.business.l@kpost.in'),
  /**
   * The business tiers' password; falls back to `QA_PASSWORD` (QATEST_ONLY keeps the original
   * here).
   */
  businessPassword: z.string().min(1).optional(),

  /** Business-tier administrator, for the company and admin-facing lookups. */
  adminKpostId: z.string().min(3).default('qa.admin@kpost.in'),
  adminPassword: z.string().min(1).default('mock-password'),
  adminUserType: z.string().min(1).default('BUSINESS_S'),

  /** A second account whose data the primary must not see, for the cross-resource validators. */
  victimKpostId: z.string().min(3).default('qa.victim@kpost.in'),
  businessReceiverKpostId: z.string().min(3).default('qa.receiver@kpost.in'),

  /**
   * Throwaway account for negative-login tests, so a lockout never hits the main accounts. Unset →
   * those specs skip.
   */
  negLoginKpostId: z.string().min(3).default('qa.neg@kpost.in'),
  negLoginPassword: z.string().default(''),

  /**
   * PERSONAL accounts 3-6 for group and multi-recipient tests (1 is `kpostId`, 2 is
   * `victimKpostId`).
   */
  personal3KpostId: z.string().min(3).default('qa.p3@kpost.in'),
  personal4KpostId: z.string().min(3).default('qa.p4@kpost.in'),
  personal5KpostId: z.string().min(3).default('qa.p5@kpost.in'),
  personal6KpostId: z.string().min(3).default('qa.p6@kpost.in'),

  /** An account that does not exist: the "not found" path and the enumeration probe. */
  kpostIdAbsent: z.string().min(3).default('no.such.user.9f2a@kpost.in'),

  // Reserved signup identities: one set per signup flow, so no two runs race for the same "is it
  // taken?" answer. On a re-run each one is "already exists", which is also a valid result.

  /** API PERSONAL registration (disposable test DB). */
  signupKpostId: z.string().min(3).default('qabench.signup@kpost.in'),
  signupMobile: z.string().min(6).default('9000000777'),

  /**
   * API BUSINESS registration; it creates a whole company, so it has its own company and unique
   * name.
   */
  businessSignupKpostId: z.string().min(3).default('qabenchapibiz@kpostindia.com'),
  businessSignupMobile: z.string().min(6).default('9000000793'),
  businessSignupCompanyName: z.string().min(3).default('QA Bench API Business Co'),
  businessSignupUniqueName: z.string().min(2).default('qabenchapibiz'),

  /**
   * UI PERSONAL signup: a local part only, because the test picks whichever domain the dropdown
   * offers.
   */
  signupUiKpostIdLocal: z.string().min(3).default('qabenchweb'),
  signupUiMobile: z.string().min(6).default('9000000778'),

  /** UI PERSONAL signup on a mobile viewport (<992px). */
  signupMobileViewportUiKpostIdLocal: z.string().min(3).default('qabenchmob'),
  signupMobileViewportUiMobile: z.string().min(6).default('9000000779'),

  /** UI Business Small signup; the KPOST ID local part is `${designationId}.${uniqueName}`. */
  signupBusinessUiMobile: z.string().min(6).default('9000000790'),
  signupBusinessCompanyName: z.string().min(3).default('QA Bench Business Co'),
  signupBusinessUniqueName: z.string().min(2).max(10).default('qabenchbz'),
  signupBusinessDesignationId: z.string().min(2).max(10).default('qabbzad'),

  /** UI Business Medium and Large signups (`MLRegister.js`), one set each. */
  signupMediumBusinessUiMobile: z.string().min(6).default('9000000791'),
  signupMediumBusinessCompanyName: z.string().min(3).default('QA Bench Medium Co'),
  signupMediumBusinessUniqueName: z.string().min(2).max(10).default('qabenchmd'),
  signupMediumBusinessDesignationId: z.string().min(2).max(10).default('qabmdad'),

  signupLargeBusinessUiMobile: z.string().min(6).default('9000000792'),
  signupLargeBusinessCompanyName: z.string().min(3).default('QA Bench Large Co'),
  signupLargeBusinessUniqueName: z.string().min(2).max(10).default('qabenchlg'),
  signupLargeBusinessDesignationId: z.string().min(2).max(10).default('qablgad'),

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
   * Each business admin's own company id (the token's `companyID` claim). Unset → not allowlisted,
   * so calls naming it are refused.
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

  /** Throwaway OTP destinations: they receive real SMS and email, so never a real person's. */
  otpMobile: z.string().min(6).default('9000000002'),
  otpEmail: z.string().email().default('qa.bench+otp@kpost.in'),
  /**
   * The role-posting test employee's mobile and email; trusted by the guard only when set in
   * `.env`.
   */
  roleEmployeeMobile: z.string().min(6).default('9000099901'),
  roleEmployeeEmail: z.string().email().default('qa.role.employee@example.com'),
  /** An OTP that is certainly wrong, for the rejection path. */
  invalidOtp: z.string().min(4).default('000000'),
  /** The test gateway's bypass OTP, which always validates. */
  bypassOtp: z.string().min(4).default('123456'),

  /**
   * The account forgot-password may rewrite; never the login account. Defaults to one that does not
   * exist.
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
  businessPassword: 'QA_BUSINESS_PASSWORD',
  adminKpostId: 'QA_ADMIN_KPOST_ID',
  adminPassword: 'QA_ADMIN_PASSWORD',
  adminUserType: 'QA_ADMIN_USER_TYPE',
  victimKpostId: 'QA_VICTIM_KPOST_ID',
  negLoginKpostId: 'QA_NEG_KPOST_ID',
  negLoginPassword: 'QA_NEG_PASSWORD',
  businessReceiverKpostId: 'QA_BUSINESS_RECEIVER_KPOST_ID',
  personal3KpostId: 'QA_PERSONAL_3_KPOST_ID',
  personal4KpostId: 'QA_PERSONAL_4_KPOST_ID',
  personal5KpostId: 'QA_PERSONAL_5_KPOST_ID',
  personal6KpostId: 'QA_PERSONAL_6_KPOST_ID',
  kpostIdAbsent: 'QA_KPOST_ID_ABSENT',
  signupKpostId: 'QA_SIGNUP_KPOST_ID',
  signupMobile: 'QA_SIGNUP_MOBILE',
  businessSignupKpostId: 'QA_BUSINESS_SIGNUP_KPOST_ID',
  businessSignupMobile: 'QA_BUSINESS_SIGNUP_MOBILE',
  businessSignupCompanyName: 'QA_BUSINESS_SIGNUP_COMPANY_NAME',
  businessSignupUniqueName: 'QA_BUSINESS_SIGNUP_UNIQUE_NAME',
  signupUiKpostIdLocal: 'QA_SIGNUP_UI_KPOST_ID_LOCAL',
  signupUiMobile: 'QA_SIGNUP_UI_MOBILE',
  signupMobileViewportUiKpostIdLocal: 'QA_SIGNUP_MOBILE_VIEWPORT_UI_KPOST_ID_LOCAL',
  signupMobileViewportUiMobile: 'QA_SIGNUP_MOBILE_VIEWPORT_UI_MOBILE',
  signupBusinessUiMobile: 'QA_SIGNUP_BUSINESS_UI_MOBILE',
  signupBusinessCompanyName: 'QA_SIGNUP_BUSINESS_COMPANY_NAME',
  signupBusinessUniqueName: 'QA_SIGNUP_BUSINESS_UNIQUE_NAME',
  signupBusinessDesignationId: 'QA_SIGNUP_BUSINESS_DESIGNATION_ID',
  signupMediumBusinessUiMobile: 'QA_SIGNUP_MEDIUM_BUSINESS_UI_MOBILE',
  signupMediumBusinessCompanyName: 'QA_SIGNUP_MEDIUM_BUSINESS_COMPANY_NAME',
  signupMediumBusinessUniqueName: 'QA_SIGNUP_MEDIUM_BUSINESS_UNIQUE_NAME',
  signupMediumBusinessDesignationId: 'QA_SIGNUP_MEDIUM_BUSINESS_DESIGNATION_ID',
  signupLargeBusinessUiMobile: 'QA_SIGNUP_LARGE_BUSINESS_UI_MOBILE',
  signupLargeBusinessCompanyName: 'QA_SIGNUP_LARGE_BUSINESS_COMPANY_NAME',
  signupLargeBusinessUniqueName: 'QA_SIGNUP_LARGE_BUSINESS_UNIQUE_NAME',
  signupLargeBusinessDesignationId: 'QA_SIGNUP_LARGE_BUSINESS_DESIGNATION_ID',
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
  roleEmployeeMobile: 'QA_ROLE_EMPLOYEE_MOBILE',
  roleEmployeeEmail: 'QA_ROLE_EMPLOYEE_EMAIL',
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
 * Identifiers that name a record somebody could own; only explicitly set ones enter the guard's
 * allowlist. A default must never stand in (e.g. `companyId` defaults to 1, a real company).
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
  'roleEmployeeMobile',
  'roleEmployeeEmail',
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
 * Identity values set explicitly in `.env` (never a default): the QA-identifier guard's allowlist.
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

/** The six PERSONAL account ids, in order, for group and multi-recipient tests. */
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

// A live run without a primary account would report every authenticated endpoint as 401.
if (env.IS_PRODUCTION && !('kpostId' in provided)) {
  throw new Error(
    'QA_KPOST_ID must be set explicitly for a live run: the default is a mock value that does ' +
      'not exist on the live application, and every authenticated endpoint would report 401.',
  );
}

export const testData = resolved;
export type TestData = typeof testData;

/** `QA_*` names still on a schema default; a "not found" on these may be the data, not a defect. */
export function unconfirmed(): string[] {
  return Object.entries(SOURCES)
    .filter(([field]) => !(field in provided))
    .map(([, variable]) => variable);
}

/** A warning for a run that is still using placeholder data. */
export function describeTestData(): string | undefined {
  const missing = unconfirmed();
  if (!missing.length) return undefined;
  return (
    `${missing.length} test-data values are still placeholders and may not exist in this ` +
    `environment: ${missing.join(', ')}`
  );
}
