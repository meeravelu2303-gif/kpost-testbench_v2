import type { RequestSpec } from '@api/client/request-builder';
import { authConfig, type Principal, type Role } from './auth.config';
import { testData } from './test-data.config';

/**
 * How an API issues tokens, declared once per API rather than once for the bench.
 *
 * ## Why this exists
 *
 * The login flow was a single global: log in at `auth-login` with `{username, password}` and read
 * the token from `data.accessToken`. That is the bench's mock. KPost logs in at
 * `/v2/signupLogin/userLogin/` with a nested `loginRO` object and returns the token at the **top
 * level**, next to `refreshToken` and a `data` block holding the profile:
 *
 *     { "statusCode": 200, "status": "SUCCESS", "message": "Login SuccessFully",
 *       "accessToken": "eyJhbGciOiJIUzUxMiJ9…", "refreshToken": "eyJhbGciOiJIUzUxMiJ9…",
 *       "isFirstTimeLogin": false, "data": { "kpostID": …, "userType": "PERSONAL" } }
 *
 * Verified against 192.168.0.66:8989 with the QA account. One global cannot describe both, and
 * every endpoint that needs a token depends on getting this right — so it becomes data, and the
 * executor picks the profile the same way it picks a host.
 *
 * ## Roles
 *
 * KPost has no SUPER_ADMIN/ADMIN/COMPANY_ADMIN/USER hierarchy; it has **user types** — PERSONAL,
 * BUSINESS_S/M/L, INSTITUTION_*. The bench's four roles are kept as the vocabulary the
 * authorization validators speak, and mapped:
 *
 *     PERSONAL    -> USER            an ordinary account
 *     BUSINESS_S  -> COMPANY_ADMIN   administers one company
 *
 * The mapping is declared here, in one place, rather than assumed in a validator.
 */
export interface AuthProfile {
  id: 'mock' | 'kpost';
  description: string;
  /** Registered endpoint the token provider logs in at. */
  loginEndpointId: string;
  /** Builds that endpoint's request for a principal. */
  loginRequest: (principal: Principal) => RequestSpec;
  /** Where the access token sits in the login response. */
  tokenPath: string;
  /** Where a refresh token sits, when the API issues one. */
  refreshTokenPath?: string;
  scheme: string;
  principals: readonly Principal[];
  /** Role used for the primary request when an endpoint names none. */
  defaultRole: Role;
}

/**
 * The device fields KPost's login requires. They are not credentials but the API rejects a login
 * without them, and a stable identity per run keeps the session list from filling with strangers.
 */
const DEVICE = {
  sessionID: 'qa-bench-session',
  deviceType: 'Web',
  deviceIdentity_primary: '9f9d6bd8-238f-11ed-b3e2-73ce62ed0e94',
  deviceIdentity_secondary: 'Desktop-Chrome',
  login_lattitude: 13.0476875,
  login_longitude: 80.2655737,
  oneSignal_Key: 'qa-bench',
  voip: 'voip',
  /** 0 = KPost, from the types contract's KPOST_MODULE group. */
  module: 0,
} as const;

/**
 * KPost's accounts, from the `QA_*` values in `.env`.
 *
 * `userType` matters: the same password logs a BUSINESS_S account in only when the tier is sent,
 * which is why it travels with the principal rather than being hard-coded in the request builder.
 */
export const KPOST_PRINCIPALS: readonly Principal[] = [
  {
    key: 'personal',
    role: 'USER',
    username: testData.kpostId,
    password: testData.password,
    userType: testData.userType,
  },
  {
    key: 'business-admin',
    role: 'COMPANY_ADMIN',
    username: testData.adminKpostId,
    password: testData.adminPassword,
    userType: testData.adminUserType,
  },
  /*
   * One principal per business tier. KPost treats the tier as part of the credential - logging the
   * BUSINESS_S account in as PERSONAL is rejected ("Invalid Credential") - so each tier is a
   * separate identity, not a role flag on one account.
   */
  {
    key: 'business-s',
    role: 'COMPANY_ADMIN',
    username: testData.businessSKpostId,
    password: testData.password,
    userType: 'BUSINESS_S',
  },
  {
    key: 'business-m',
    role: 'COMPANY_ADMIN',
    username: testData.businessMKpostId,
    password: testData.password,
    userType: 'BUSINESS_M',
  },
  {
    key: 'business-l',
    role: 'COMPANY_ADMIN',
    username: testData.businessLKpostId,
    password: testData.password,
    userType: 'BUSINESS_L',
  },
  /*
   * A second real account owning data the first must not see. The cross-resource validators use it
   * to prove an endpoint checks ownership instead of trusting the id it was given.
   */
  {
    key: 'victim',
    role: 'USER',
    username: testData.victimKpostId,
    password: testData.password,
    userType: testData.userType,
  },
];

export const AUTH_PROFILES: Record<AuthProfile['id'], AuthProfile> = {
  /** The bench's own mock API, used by the framework self-tests. */
  mock: {
    id: 'mock',
    description: 'mock API: username/password, token at data.accessToken',
    loginEndpointId: authConfig.loginEndpointId,
    loginRequest: authConfig.loginRequest,
    tokenPath: authConfig.tokenPath,
    scheme: authConfig.scheme,
    principals: authConfig.principals,
    defaultRole: authConfig.defaultRole,
  },

  /** The real KPost auth service, shared by KPost core, Admin and KMail. */
  kpost: {
    id: 'kpost',
    description: 'KPost: loginRO payload, token at the top-level accessToken',
    loginEndpointId: 'signup-login-user-login',
    loginRequest: (principal) => ({
      body: {
        ...DEVICE,
        kpostID: principal.username,
        loginRO: {
          countryID: String(testData.countryId),
          password: principal.password,
          userType: principal.userType ?? 'PERSONAL',
        },
        logintime: Date.now(),
      },
    }),
    tokenPath: 'accessToken',
    refreshTokenPath: 'refreshToken',
    scheme: 'Bearer',
    principals: KPOST_PRINCIPALS,
    defaultRole: 'USER',
  },
};

/**
 * Bench fixtures authenticate against the mock; everything else against KPost.
 *
 * Deliberately the same signal as the base URL (`mockFixture`), so a host and its credentials can
 * never disagree — a token minted by the mock and sent to the live API would fail as "invalid
 * token" and look like an API defect.
 */
export function authProfileFor(definition: { mockFixture?: boolean }): AuthProfile {
  return definition.mockFixture ? AUTH_PROFILES.mock : AUTH_PROFILES.kpost;
}

/**
 * A principal with `role` from a profile, optionally one belonging to a different tenant.
 *
 * The role vocabulary is the bench's (USER, COMPANY_ADMIN, …); which real account fills it is the
 * profile's business. The authorization validators ask for "a principal of another tenant" and get
 * the right live account without knowing anything about user types.
 */
export function principalForRole(
  profile: AuthProfile,
  role: Role,
  options: { foreignTenantOf?: string } = {},
): Principal | undefined {
  return profile.principals.find(
    (p) =>
      p.role === role &&
      (options.foreignTenantOf === undefined ||
        (p.tenantId !== undefined && p.tenantId !== options.foreignTenantOf)),
  );
}
