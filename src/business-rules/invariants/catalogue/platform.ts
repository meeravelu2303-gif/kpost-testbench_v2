import type { BusinessInvariant } from '../invariant';

const SL_FRD =
  'D:/Kpost Documents/KPOST_FRD_Module1_SignupLogin_v1.7.docx (via docs/business-rules.md § Signup & Login)';
const KD_FRD =
  'D:/Kpost Documents/KPOST_FRD_Module5_KDirectory_v1.0.docx (via docs/business-rules.md § KDirectory)';
const ADMIN_DOC = 'docs/admin-flow.md + CLAUDE.md §8 (via docs/business-rules.md § Admin)';

/** Signup & Login — the gate to everything else. */
export const SIGNUP_LOGIN_INVARIANTS: readonly BusinessInvariant[] = [
  {
    invariantId: 'BR-SL-UNIQUE',
    module: 'signup-login',
    statement:
      'An already-registered KPost ID is reported as taken and cannot be registered again.',
    provenance: { status: 'DOCUMENTED', citation: `${SL_FRD} → BR-S02` },
    requirements: ['FR-SL-003'],
    actors: ['sender'],
    appliesTo: ['signup-login-kpost-id-exist'],
    preconditions: ['one id known to exist and one known to be free'],
    expected: 'the existing id reads as not-available and the free id reads as available',
    evidence: ['RESPONSE_FIELD'],
    status: 'VERIFIED',
    verifiedBy: 'tests/api/kpost/signup-login/coverage.spec.ts + the common identity specs',
  },
  {
    invariantId: 'BR-SL-ENUM',
    module: 'signup-login',
    statement:
      'A wrong password and an unknown account answer identically, so login cannot be used to discover who has an account.',
    provenance: {
      status: 'DOCUMENTED',
      citation: `${SL_FRD} → account-enumeration precaution; CLAUDE.md §2`,
    },
    requirements: ['FR-SL-024', 'NFR-SEC01'],
    actors: ['sender'],
    appliesTo: ['signup-login-user-login'],
    preconditions: ['a real account and an id known not to exist'],
    expected: 'both attempts return the same status and the same message',
    evidence: ['RESPONSE_FIELD'],
    status: 'VERIFIED',
    verifiedBy: 'tests/api/kpost/signup-login/login-flow.spec.ts',
  },
  {
    invariantId: 'BR-SL-ACTIVATE',
    module: 'signup-login',
    statement:
      'Login before account activation must fail; activation is a separate mandatory step.',
    provenance: { status: 'DOCUMENTED', citation: `${SL_FRD} → BR-S01; SRS-S03` },
    requirements: ['FR-SL-006'],
    actors: ['sender'],
    appliesTo: ['signup-login-user-login'],
    preconditions: ['a freshly registered, not-yet-activated account'],
    expected: 'login on a not-activated account issues no token',
    evidence: ['REJECTION'],
    status: 'OUT_OF_SCOPE',
    gap: 'No activation endpoint exists in any of the 356 documented rows (CLAUDE.md §8 2026-09-12). Either activation happens outside the API, the workbook is missing it, or signup activates immediately and the rule is unimplemented — unresolved.',
    conflict:
      'BR-S01 requires activation; the documented API contains no activation endpoint. Preserved as a documentation/implementation conflict.',
  },
  {
    invariantId: 'BR-SL-JWT',
    module: 'signup-login',
    statement:
      'A successful login issues a signed JWT, and every authenticated operation requires a valid one.',
    provenance: { status: 'DOCUMENTED', citation: `${SL_FRD} → FR-SL-023..026; NFR-SEC01` },
    requirements: ['FR-SL-023', 'NFR-SEC01'],
    actors: ['sender'],
    appliesTo: ['signup-login-user-login'],
    preconditions: ['a real account'],
    expected:
      'the token is signed, expires, names our account as its subject, and a missing or tampered token is rejected',
    evidence: ['RESPONSE_FIELD', 'REJECTION'],
    status: 'VERIFIED',
    verifiedBy:
      'tests/api/kpost/signup-login/login-flow.spec.ts + the engine authentication validators',
  },
  {
    invariantId: 'BR-SL-LOGOUT',
    module: 'signup-login',
    statement: 'Logout invalidates the session token it was sent with.',
    provenance: { status: 'DOCUMENTED', citation: `${SL_FRD} → FR-SL-032; SRS-S05` },
    requirements: ['FR-SL-032'],
    actors: ['sender'],
    appliesTo: ['signup-login-user-logout'],
    preconditions: ['a session opened specifically for the test, on its own device id'],
    expected:
      'after logout the token no longer authenticates, and the shared session is unaffected',
    evidence: ['REJECTION'],
    status: 'PARTIAL',
    verifiedBy: 'tests/api/kpost/signup-login/login-flow.spec.ts',
    gap: 'the spec proves the shared session survives; that the logged-out token itself stops working is not asserted.',
  },
  {
    invariantId: 'BR-SL-PWD',
    module: 'signup-login',
    statement:
      'A password must be at least 8 characters with an upper case, a lower case, a digit and a special character.',
    provenance: { status: 'DOCUMENTED', citation: `${SL_FRD} → NFR-SEC03` },
    requirements: ['NFR-SEC03'],
    actors: ['sender'],
    appliesTo: ['signup-login-signup'],
    preconditions: ['the OTP test gateway and a disposable database'],
    expected: 'a password missing any one character class is refused',
    evidence: ['REJECTION'],
    status: 'OUT_OF_SCOPE',
    gap: 'exercising it means attempting real registrations, each of which mints a PERMANENT account KPOST cannot delete. Needs an explicit owner decision, not a test-bench one.',
  },
  {
    invariantId: 'BR-SL-3IDS',
    module: 'signup-login',
    statement:
      'The same account authenticates by mobile number, by bare KPost ID and by full KPost ID with domain.',
    provenance: { status: 'DOCUMENTED', citation: `${SL_FRD} → FR-SL-023` },
    requirements: ['FR-SL-023'],
    actors: ['sender'],
    appliesTo: ['signup-login-user-login', 'signup-login-fetch-user-details'],
    preconditions: ['one account whose three identifier forms are all known'],
    expected: 'each of the three forms issues a token for the same subject',
    evidence: ['RESPONSE_FIELD'],
    status: 'TO_DO',
  },
];

/** KDirectory — the organisation directory. */
export const KDIRECTORY_INVARIANTS: readonly BusinessInvariant[] = [
  {
    invariantId: 'FR-KD-002-ORG-SCOPE',
    module: 'kdirectory',
    statement: "The directory shows only users within the viewer's own organisation.",
    provenance: { status: 'DOCUMENTED', citation: `${KD_FRD} → FR-KD-002` },
    requirements: ['FR-KD-002'],
    actors: ['sender'],
    appliesTo: ['contacts-global-search'],
    preconditions: ['a business account, and a known user in a different organisation'],
    expected: "a search returns no user outside the viewer's organisation",
    evidence: ['ABSENCE', 'CROSS_ACTOR'],
    status: 'TO_DO',
    gap: 'proving absence needs a known out-of-org user, and the QA-identifier guard correctly refuses naming an account we do not own — so the assertion must be built from what the response DOES contain, not from probing a stranger.',
  },
  {
    invariantId: 'FR-KD-002-SEARCH',
    module: 'kdirectory',
    statement: 'Directory search matches by name; a query with no match returns an empty result.',
    provenance: { status: 'DOCUMENTED', citation: `${KD_FRD} → FR-KD-002` },
    requirements: ['FR-KD-002'],
    actors: ['sender'],
    appliesTo: ['contacts-global-search'],
    preconditions: ['an authenticated account'],
    expected: 'every returned entry matches the query; an unmatchable query returns nothing',
    evidence: ['RESPONSE_FIELD'],
    status: 'PARTIAL',
    verifiedBy: 'tests/api/kpost/contacts/read.spec.ts (contract matrix)',
    gap: 'the search is exercised; that the results actually match the query is not asserted.',
  },
  {
    invariantId: 'FR-KD-003',
    module: 'kdirectory',
    statement: 'Each directory entry shows the name, the role/designation and the team.',
    provenance: { status: 'DOCUMENTED', citation: `${KD_FRD} → FR-KD-003` },
    requirements: ['FR-KD-003'],
    actors: ['sender'],
    appliesTo: ['contacts-global-search', 'contacts-my-contacts'],
    preconditions: ['a directory containing at least one entry'],
    expected: 'each entry carries all three fields',
    evidence: ['RESPONSE_FIELD'],
    status: 'TO_DO',
  },
  {
    invariantId: 'FR-KD-005',
    module: 'kdirectory',
    statement: "Opening a directory entry returns that user's full profile.",
    provenance: { status: 'DOCUMENTED', citation: `${KD_FRD} → FR-KD-005` },
    requirements: ['FR-KD-005'],
    actors: ['sender'],
    appliesTo: ['profile-user-profile-by-kpostid'],
    preconditions: ['a second QA account whose profile we may read'],
    expected: "the profile returned is the selected user's, not the caller's",
    evidence: ['RESPONSE_FIELD', 'CROSS_ACTOR'],
    status: 'VERIFIED',
    verifiedBy: 'tests/api/kpost/profile/read.spec.ts (contract matrix)',
  },
];

/** Admin / HR-Setup. */
export const ADMIN_INVARIANTS: readonly BusinessInvariant[] = [
  {
    invariantId: 'BR-ADM-TIER-ORDER',
    module: 'admin',
    statement:
      'The organisation build is strictly ordered: each step produces the identifier the next step needs (workplace tier → variable → location → HR tier → variable → employee).',
    provenance: { status: 'DOCUMENTED', citation: `${ADMIN_DOC} → the ordered build sequence` },
    requirements: [],
    actors: ['group-admin'],
    appliesTo: [
      'admin-workplace-tier-attribute-save',
      'admin-workplace-tier-variable-save',
      'admin-workplace-location-save',
      'admin-hr-tier-attribute-save',
      'admin-hr-tier-variable-save',
      'admin-employee-save',
    ],
    preconditions: ['a BUSINESS_M admin and a company to build in'],
    expected: "each step's minted id is accepted by the next, and every step reads back",
    evidence: ['RESPONSE_FIELD', 'READ_BACK'],
    status: 'VERIFIED',
    verifiedBy: 'tests/api/admin/feature.spec.ts',
  },
  {
    invariantId: 'BR-ADM-500-VALIDATION',
    module: 'admin',
    statement: 'A missing required field is answered with a client error, never a server error.',
    provenance: {
      status: 'OBSERVED',
      citation: 'CLAUDE.md §8 2026-09-16 — employeeDetails/save NPEs (500) without employmentObj',
      note: 'A general API expectation rather than a module FRD rule; recorded as OBSERVED evidence of a real defect.',
    },
    requirements: [],
    actors: ['group-admin'],
    appliesTo: ['admin-employee-save'],
    preconditions: ['a BUSINESS_M admin'],
    expected: 'omitting a required object yields a 4xx naming the field, not a 500 NPE',
    evidence: ['REJECTION'],
    status: 'VERIFIED',
    verifiedBy: 'tests/api/admin/feature.spec.ts (the 500 is recorded as a finding)',
  },
];
