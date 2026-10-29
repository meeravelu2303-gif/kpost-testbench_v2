import { testData } from '@config/test-data.config';
import { typesOnlySchema } from '@api/schema/sample-schema';
import { body, defineKpostEndpoint, defineUndocumentedKpostEndpoint } from '../kpost-endpoint';

/**
 * Registration and the signup form's pre-submit checks. The writes run only on the OTP test gateway
 * (OTP_TEST_GATEWAY + TEST_DB_MODE), with the reserved signup identities; a re-run gets "already
 * exists".
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
  tags: [...SIGNUP_TAGS, 'critical'],
  // `global`: the API cannot delete an account, so each run leaves a row on the disposable test DB.
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
  // OTP-gated and global, so never on production; the types-only schema enables off-live negative
  // cases.
  requestSchema: typesOnlySchema({
    kpostID: testData.signupKpostId,
    firstName: 'QA',
    lastName: 'Bench',
    mobileNumber: testData.signupMobile,
    createdDate: Date.now(),
    password: testData.password,
    gender: 'female',
    dateOfBirth: '1995-01-01',
    module: 0,
    countryCode: '91',
    email: testData.otpEmail,
    userProfile: {},
  }),
});

export const signupGetApi = defineKpostEndpoint({
  id: 'signup-login-signup-get',
  // A GET on the signup path answers 405; it pins a stale workbook row.
  expectedStatus: [405],
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
  tags: [...SIGNUP_TAGS, 'business-tier'],
  // Creates a whole company per run; `global` because companies accumulate and use up unique names.
  destructive: true,
  sideEffect: 'global',
  request: body(() => ({
    kpostID: testData.businessSignupKpostId,
    companyName: testData.businessSignupCompanyName,
    entity: 'Vegetable Shop',
    uniqueName: testData.businessSignupUniqueName,
    firstName: 'QA',
    lastName: 'Bench',
    mobileNumber: testData.businessSignupMobile,
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
  // OTP-gated + global (never runs on production); schema enables off-live negative/injection cases.
  requestSchema: typesOnlySchema({
    kpostID: testData.businessSignupKpostId,
    companyName: testData.businessSignupCompanyName,
    entity: 'Vegetable Shop',
    uniqueName: testData.businessSignupUniqueName,
    firstName: 'QA',
    lastName: 'Bench',
    mobileNumber: testData.businessSignupMobile,
    otherEmail: testData.otpEmail,
    password: testData.password,
    gender: 'female',
    dateOfBirth: '1995-01-01',
    countryID: String(testData.countryId),
    countryCode: '91',
    language: 'english',
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
  }),
});

export const kpostIdExistApi = defineKpostEndpoint({
  id: 'signup-login-kpost-id-exist',
  requirements: ['FR-SL-003'],
  method: 'POST',
  path: '/v2/signupLogin/kpostIdExist/',
  summary: 'Check whether a KPost ID is already taken',
  tags: [...SIGNUP_TAGS, 'enumeration-surface'],
  destructive: false,
  // Asked with the configured absent id/mobile, so the happy path is "available"; the spec covers
  // "taken".
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

export const businessAddingUserPublicApi = defineUndocumentedKpostEndpoint({
  id: 'signup-login-business-adding-user-public',
  method: 'POST',
  path: '/signupLoginForMediumAndLarge/addingUserByAdmin',
  summary: 'Create a member account in a medium/large company (no login required)',
  tags: ['signup-login', 'signup', 'user-management', 'security'],
  authentication: { required: false },
  // Public account creation in ANY company from the body: never driven with a full body.
  destructive: true,
  sideEffect: 'global',
  evidence:
    'SignUpLoginForMediumAndLargeController.java:73-92 (public: SecurityConfiguration:71; the admin ' +
    'check is commented out at :79); EmployeeDetailsEntityToRegistrationRO.java:25-73; no client calls it',
  note:
    'security defect candidate: an unauthenticated account-creation endpoint. In this source it always ' +
    '500s (the mapper never sets kpostID), but the live server may be newer — prove "no login gate" with ' +
    'the zero-write probe (no token, unparseable body) before filing',
});

export const signupApis = [
  signupApi,
  signupGetApi,
  adminRegistrationApi,
  kpostIdExistApi,
  kpostIdSuggestionApi,
  businessAddingUserPublicApi,
];
