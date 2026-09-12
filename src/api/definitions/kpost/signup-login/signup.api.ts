import { randomUUID } from 'node:crypto';
import { testData } from '@config/test-data.config';
import { body, defineKpostEndpoint } from '../kpost-endpoint';

/**
 * Registration: creating an account, and the checks a signup form makes before it submits.
 *
 * ## Fresh identities, every run
 *
 * A signup cannot reuse an identifier, so `newKpostId()` and `newMobile()` mint one per call.
 * Reusing a fixed value would make the first run pass and every later run fail with "already
 * exists" — a test that reports a defect the second time it is used is worse than no test.
 *
 * The generated values stay inside a reserved range (`qa.bench.*@kpost.in`,
 * `98765xxxxx`) so the rows they leave behind are identifiable and can be cleaned up, and so a
 * generated number can never collide with a real customer's.
 *
 * ## BR-S02, from the FRD
 *
 * "An identifier that already exists is rejected at submission, not deferred to activation." That
 * is what `kpostIdExist` is for, and it is the one rule here the workbook cannot express — so it
 * is tested explicitly in the spec rather than left to the schema validators.
 */
const SIGNUP_TAGS = ['signup-login', 'signup'] as const;

/** A KPost ID that cannot already exist. */
const newKpostId = (): string => `qa.bench.${randomUUID().slice(0, 8)}@kpost.in`;
/** A mobile number in a reserved test range, so it can never be a real customer's. */
const newMobile = (): string =>
  `98765${String(Math.floor(Math.random() * 100_000)).padStart(5, '0')}`;

export const signupApi = defineKpostEndpoint({
  id: 'signup-login-signup',
  method: 'POST',
  path: '/v2/signupLogin/signup/',
  summary: 'Register a personal account',
  tags: [...SIGNUP_TAGS, 'critical'],
  /*
   * Creates a row the tests own, which is `data` rather than `global` - but it is still a write to
   * a shared database, and each run leaves an account behind. Worth knowing when reviewing the
   * environment; see the note above about the reserved ranges.
   */
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    kpostID: newKpostId(),
    firstName: 'QA',
    lastName: 'Bench',
    mobileNumber: newMobile(),
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
  method: 'GET',
  path: '/v2/signupLogin/signup/',
  summary: 'GET variant of the signup route documented in Sheet3',
  tags: SIGNUP_TAGS,
  /*
   * Sheet3 R13 documents this path with no payload, so the method rule derived GET. Whether a GET
   * on the signup route is real or another incomplete row is an open question with the API owner -
   * the same situation as `mobileNoExist`, which turned out to be stale. It is registered so the
   * answer is measured rather than assumed: if the route does not exist the bench reports it.
   */
  destructive: false,
});

export const adminRegistrationApi = defineKpostEndpoint({
  id: 'signup-login-admin-registration',
  method: 'POST',
  path: '/v2/signupLogin/adminRegistration/',
  summary: 'Register a business account and its company',
  tags: [...SIGNUP_TAGS, 'business-tier'],
  /*
   * Creates a company as well as an account - a whole tenant per run. `global` rather than `data`:
   * companies accumulate, appear in other tenants' lookups, and consume a unique name and domain
   * that cannot be released.
   */
  destructive: true,
  sideEffect: 'global',
  request: body(() => {
    const slug = `qab${randomUUID().slice(0, 6)}`;
    return {
      kpostID: `md@${slug}.kpost.in`,
      companyName: `QA Bench ${slug}`,
      entity: 'Vegetable Shop',
      uniqueName: slug,
      firstName: 'QA',
      lastName: 'Bench',
      mobileNumber: newMobile(),
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
    };
  }),
});

export const kpostIdExistApi = defineKpostEndpoint({
  id: 'signup-login-kpost-id-exist',
  method: 'POST',
  path: '/v2/signupLogin/kpostIdExist/',
  summary: 'Check whether a KPost ID is already taken',
  tags: [...SIGNUP_TAGS, 'enumeration-surface'],
  destructive: false,
  /*
   * Asked with an id that does NOT exist, so the happy path is "available". The "already taken"
   * path is BR-S02 and is asserted explicitly in the spec, where the answer can be compared
   * against a real account instead of hoping the environment contains one.
   */
  request: body(() => ({
    kpostID: newKpostId(),
    firstName: 'QA',
    lastName: 'Bench',
    mobileNumber: newMobile(),
  })),
});

export const kpostIdSuggestionApi = defineKpostEndpoint({
  id: 'signup-login-kpost-id-suggestions',
  method: 'POST',
  path: '/v2/signupLogin/kpostIDsuggestionList/',
  summary: 'Suggest available KPost IDs for a name',
  tags: SIGNUP_TAGS,
  destructive: false,
  request: body(() => ({
    firstName: 'QA',
    lastName: 'Bench',
    mobileNumber: newMobile(),
  })),
});

export const fetchUserDetailsApi = defineKpostEndpoint({
  id: 'signup-login-fetch-user-details',
  method: 'POST',
  path: '/v2/signupLogin/fetchUserDetails/',
  summary: "Fetch an account's details during signup or login",
  tags: [...SIGNUP_TAGS, 'pii'],
  destructive: false,
  /*
   * Public, and it returns somebody's name and country from their KPost ID alone. Legitimate for a
   * login form; also an enumeration and PII surface, which is what the central
   * information-disclosure and sensitive-data validators probe.
   */
  request: body(() => ({ kpostID: testData.kpostId, countryID: testData.countryId })),
});

export const signupApis = [
  signupApi,
  signupGetApi,
  adminRegistrationApi,
  kpostIdExistApi,
  kpostIdSuggestionApi,
  fetchUserDetailsApi,
];
