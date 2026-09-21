import { testData } from '@config/test-data.config';
import { body, defineKpostEndpoint } from '../kpost-endpoint';

/**
 * Registration — creating an account, and the checks a signup form makes before it submits.
 *
 * ## Back in scope: the OTP test gateway
 *
 * Signup was out of scope while the live application had no OTP bypass. The testingapi **test DB** now
 * runs a TEST GATEWAY — `sendOTP`/`sendOTPtoMail` create the OTP record but deliver no real SMS/e-mail,
 * and `123456` (`QA_BYPASS_OTP`) always validates. So with `OTP_TEST_GATEWAY=true` + `TEST_DB_MODE=true`
 * these `otpDependent: 'requires'` writes run end to end (the guard opens them; see `production-guard`).
 *
 * ## Identities are ALLOWLISTED, not random
 *
 * The old version minted a random `98765…` mobile per run, which the QA-identifier guard (rightly)
 * refuses. A registration creates a brand-new account — it names no existing user — so it uses the
 * reserved, allowlisted `testData.signupKpostId` / `signupMobile`. On a fresh/reset test DB a signup
 * succeeds; on a re-run it is "already exists" (BR-S02) — both are valid, so reset the disposable DB
 * between full runs. Payload fields follow the workbook / `openapi/kpost-api.openapi.json`.
 */
const SIGNUP_TAGS = ['signup-login', 'signup'] as const;

export const signupApi = defineKpostEndpoint({
  id: 'signup-login-signup',
  // Registration needs both OTPs validated; runs only on the OTP test gateway (OTP_TEST_GATEWAY).
  otpDependent: 'requires',
  requirements: ['FR-SL-001', 'FR-SL-002', 'FR-SL-003', 'FR-SL-004', 'FR-SL-005', 'NFR-SEC03'],
  method: 'POST',
  path: '/v2/signupLogin/signup/',
  summary: 'Register a personal account',
  // `mints-account`: the generated contract spec EXCLUDES this tag. An account cannot be deleted
  // through this API, so a fuzzed registration leaves a permanent row behind — the availability
  // READS beside it are safe to fuzz, this is not. It is driven deliberately by
  // `otp-signup-lifecycle.spec.ts` on the OTP test gateway instead.
  tags: [...SIGNUP_TAGS, 'critical', 'mints-account'],
  /*
   * `global`: an account cannot be deleted through this API, so a run leaves a `qabench.signup@`
   * row behind — fine on a disposable test DB, reset between full runs.
   */
  destructive: true,
  sideEffect: 'global',
  request: body(() => ({
    kpostID: testData.signupKpostId,
    firstName: 'QA',
    lastName: 'Bench',
    mobileNumber: testData.signupMobile,
    createdDate: Date.now(),
    password: testData.password,
    gender: 'female',
    dateOfBirth: '1995-01-01',
    // 0 = KPost, from the types contract's KPOST_MODULE group.
    module: 0,
    countryCode: '91',
    email: testData.otpEmail,
    userProfile: {
      landLineNumber: '04400000000',
      referalId: '',
      pinCode: testData.pinCode,
      areaName: 'Pazhavanthangal',
      state: 'Tamil Nadu',
      city: 'Chennai',
    },
  })),
});

export const signupGetApi = defineKpostEndpoint({
  id: 'signup-login-signup-get',
  // A GET on the signup path — answers 405; harmless, and pins a stale Sheet3 row.
  productionSafe: true,
  requirements: ['FR-SL-001'],
  method: 'GET',
  path: '/v2/signupLogin/signup/',
  summary: 'GET variant of the signup route documented in Sheet3',
  tags: SIGNUP_TAGS,
  destructive: false,
});

export const adminRegistrationApi = defineKpostEndpoint({
  id: 'signup-login-admin-registration',
  otpDependent: 'requires',
  requirements: ['FR-SL-001', 'FR-SL-005'],
  method: 'POST',
  path: '/v2/signupLogin/adminRegistration/',
  summary: 'Register a business account and its company',
  // `mints-account` — and this one mints a whole TENANT (see the note below), so it is excluded
  // from the generated contract spec for the same reason, and more strongly.
  tags: [...SIGNUP_TAGS, 'business-tier', 'mints-account'],
  /*
   * Creates a company as well as an account — a whole tenant per run. `global`: companies accumulate,
   * appear in other tenants' lookups, and consume a unique name/domain that cannot be released.
   */
  destructive: true,
  sideEffect: 'global',
  request: body(() => ({
    kpostID: testData.signupKpostId,
    companyName: testData.companyNameAbsent,
    entity: 'Vegetable Shop',
    uniqueName: 'qabenchsignup',
    firstName: 'QA',
    lastName: 'Bench',
    mobileNumber: testData.signupMobile,
    otherEmail: testData.otpEmail,
    password: testData.password,
    gender: 'female',
    dateOfBirth: '1995-01-01',
    countryID: String(testData.countryId),
    countryCode: '91',
    language: 'english',
    // BUSINESS_M is the documented sample; the tier decides the member limit.
    userType: 'BUSINESS_M',
    address1: '39 Chettinad Chamber',
    address2: 'Dr. Radhakrishnan Salai',
    country: 'india',
    state: 'TamilNadu',
    city: 'Chennai',
    areaName: 'Mylapore',
    designation: 'Managing Director',
    role: '',
    pinCode: testData.pinCode,
    referenceName: 'QABENCH',
  })),
});

export const kpostIdExistApi = defineKpostEndpoint({
  id: 'signup-login-kpost-id-exist',
  requirements: ['FR-SL-003'],
  method: 'POST',
  path: '/v2/signupLogin/kpostIdExist/',
  summary: 'Check whether a KPost ID is already taken',
  tags: [...SIGNUP_TAGS, 'enumeration-surface'],
  destructive: false,
  /*
   * Asked with the CONFIGURED absent id/mobile (known-unused, allowlisted), so the happy path is
   * "available". The "already taken" path (BR-S02) is asserted in the spec against a real account.
   */
  request: body(() => ({
    kpostID: testData.kpostIdAbsent,
    firstName: 'QA',
    lastName: 'Bench',
    mobileNumber: testData.mobileAbsent,
  })),
  productionSafe: true,
});

export const kpostIdSuggestionApi = defineKpostEndpoint({
  id: 'signup-login-kpost-id-suggestions',
  // Suggests ids from a first/last name; names no existing record.
  productionSafe: true,
  requirements: ['FR-SL-003'],
  method: 'POST',
  path: '/v2/signupLogin/kpostIDsuggestionList/',
  summary: 'Suggest available KPost IDs for a name',
  tags: SIGNUP_TAGS,
  destructive: false,
  request: body(() => ({
    kpostID: testData.signupKpostId,
    firstName: 'QA',
    lastName: 'Bench',
    mobileNumber: testData.signupMobile,
  })),
});

export const signupApis = [
  signupApi,
  signupGetApi,
  adminRegistrationApi,
  kpostIdExistApi,
  kpostIdSuggestionApi,
];
