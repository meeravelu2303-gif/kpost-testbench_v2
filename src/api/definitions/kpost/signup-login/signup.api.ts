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
 * The generated id is prefixed `qabench…@kpost.in`, so the rows it leaves behind are identifiable.
 * **The generated mobile number is not in a reserved range**, despite what this comment used to
 * say: `98765…` is ordinary Indian mobile space and one of the live QA accounts sits at
 * 9876543211, so a generated number CAN collide with a real person's. That is tolerable only
 * because registration is OTP-gated and blocked on the live application. The read-only lookups
 * use `testData.mobileAbsent` — a configured, known-unused number — for exactly this reason.
 *
 * ## BR-S02, from the FRD
 *
 * "An identifier that already exists is rejected at submission, not deferred to activation." That
 * is what `kpostIdExist` is for, and it is the one rule here the workbook cannot express — so it
 * is tested explicitly in the spec rather than left to the schema validators.
 */
const SIGNUP_TAGS = ['signup-login', 'signup'] as const;

/**
 * A KPost ID that cannot already exist, in the format the API accepts.
 *
 * No dots in the local part: `qa.bench.x@kpost.in` is rejected with
 * `"kpostID must start with a letter or Invalid kpostID"`. The rule is undocumented - the
 * workbook's own sample (`jitendra@tn.kpost.in`) happens to satisfy it, so the constraint was
 * invisible until the bench sent something else. Letters first, then hex.
 */
const newKpostId = (): string => `qabench${randomUUID().replace(/-/g, '').slice(0, 10)}@kpost.in`;
/**
 * A random mobile number, for REGISTRATION only — where each run needs an unused number.
 *
 * It is not a reserved range, whatever this comment used to claim: `98765…` is ordinary Indian
 * mobile space, and one of the live QA accounts sits at 9876543211. On the live application a
 * random number here would mean sending lookups — and, on the OTP endpoints, real SMS — to
 * strangers. Registration is OTP-gated and blocked on live, so this stays for dev use only; the
 * lookup endpoints use `testData.mobileAbsent` instead, which is a configured, known-unused value.
 */
const newMobile = (): string =>
  `98765${String(Math.floor(Math.random() * 100_000)).padStart(5, '0')}`;

export const signupApi = defineKpostEndpoint({
  id: 'signup-login-signup',
  // Registration needs both OTPs validated; live has no bypass, so it cannot run there.
  otpDependent: 'requires',
  requirements: ['FR-S01', 'FR-S02', 'FR-S03', 'FR-S04', 'FR-S05', 'NFR-SEC03'],
  method: 'POST',
  path: '/v2/signupLogin/signup/',
  summary: 'Register a personal account',
  tags: [...SIGNUP_TAGS, 'critical'],
  /*
   * `global`, not `data`, at the owner's instruction: **do not create users frequently.**
   *
   * An account cannot be deleted through this API, so "data the tests own" is the wrong category -
   * every run would leave one behind permanently and the environment would fill with
   * `qabench*@kpost.in`. Registration therefore runs only with ALLOW_DESTRUCTIVE_TESTS=true, when
   * someone has decided to exercise it.
   */
  destructive: true,
  sideEffect: 'global',
  /*
   * **Registration is not callable in isolation.** With a well-formed, unused id the API still
   * answers `400 "Enter valid Credentials"`, which points at an unmet prerequisite rather than a
   * bad payload - almost certainly an OTP-verified mobile number (sendOTP -> validateOTP -> signup),
   * matching the FRD's flow. Until that chain is wired, this endpoint's primary request is expected
   * to fail and the failure is NOT a defect. Recorded here so nobody files it as one.
   */
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
  // Live: A GET on the signup path - answers 405. Harmless, and pins a stale row.
  productionSafe: true,
  requirements: ['FR-S01'],
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
  // Registration needs both OTPs validated; live has no bypass, so it cannot run there.
  otpDependent: 'requires',
  requirements: ['FR-S01', 'FR-S05'],
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
  requirements: ['FR-S03', 'BR-S02'],
  method: 'POST',
  path: '/v2/signupLogin/kpostIdExist/',
  summary: 'Check whether a KPost ID is already taken',
  tags: [...SIGNUP_TAGS, 'enumeration-surface'],
  destructive: false,
  /*
   * Asked with an id that does NOT exist, so the happy path is "available". The "already taken"
   * path is BR-S02 and is asserted explicitly in the spec, where the answer can be compared
   * against a real account instead of hoping the environment contains one.
   *
   * The values are the CONFIGURED absent ones, not freshly generated: a random `98765…` number is
   * somebody's real mobile on the live application, and this endpoint is an enumeration surface.
   * `QA_KPOST_ID_ABSENT` / `QA_MOBILE_ABSENT` are known-unused and are in the identifier guard's
   * allowlist, so this runs on live; a generated id would be refused by that guard, correctly.
   */
  request: body(() => ({
    kpostID: testData.kpostIdAbsent,
    firstName: 'QA',
    lastName: 'Bench',
    mobileNumber: testData.mobileAbsent,
  })),
  // Reads only, with values that match nothing. See the note above on why they are configured.
  productionSafe: true,
});

export const kpostIdSuggestionApi = defineKpostEndpoint({
  id: 'signup-login-kpost-id-suggestions',
  // Live: Suggests ids from a first/last name. Names no existing record.
  productionSafe: true,
  requirements: ['FR-S03'],
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
  // Live: Reads OUR OWN profile, asked with QA_KPOST_ID.
  productionSafe: true,
  requirements: ['FR-S09'],
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
