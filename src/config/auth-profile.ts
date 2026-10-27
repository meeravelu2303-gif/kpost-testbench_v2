import { randomUUID } from 'node:crypto';
import type { RequestSpec } from '@api/client/request-builder';
import type { Principal, Role } from './auth.config';
import { env } from './env';
import { isProvided, testData, type TestData } from './test-data.config';

/**
 * How an API issues tokens: login endpoint, payload and where the token sits in the response. KPost
 * user types map to the bench's roles here (PERSONAL → USER, BUSINESS_* → COMPANY_ADMIN).
 */
export interface AuthProfile {
  id: 'kpost';
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
 * The device every token-provider login claims to be; a test that logs out must use a different
 * one.
 */
export const KPOST_DEVICE_IDENTITY = '9f9d6bd8-238f-11ed-b3e2-73ce62ed0e94';

/**
 * Device fields the login requires. `sessionID` is not here: a shared one makes logins clobber each
 * other's tokens.
 */
const DEVICE = {
  deviceType: 'Web',
  deviceIdentity_primary: KPOST_DEVICE_IDENTITY,
  deviceIdentity_secondary: 'Desktop-Chrome',
  login_lattitude: 13.0476875,
  login_longitude: 80.2655737,
  oneSignal_Key: 'qa-bench',
  voip: 'voip',
  /** 0 = KPost, from the types contract's KPOST_MODULE group. */
  module: 0,
} as const;

/**
 * KPost's accounts from `.env`; `userType` travels with each, since the tier is part of the
 * credential.
 */
const ALL_KPOST_PRINCIPALS: readonly (Principal & { account: keyof TestData })[] = [
  {
    key: 'personal',
    account: 'kpostId',
    role: 'USER',
    username: testData.kpostId,
    password: testData.password,
    userType: testData.userType,
  },
  {
    key: 'business-admin',
    account: 'adminKpostId',
    role: 'COMPANY_ADMIN',
    username: testData.adminKpostId,
    password: testData.adminPassword,
    userType: testData.adminUserType,
  },
  // One principal per business tier. `tenantId` lets the cross-tenant validator pick an admin of
  // another company.
  {
    key: 'business-s',
    account: 'businessSKpostId',
    role: 'COMPANY_ADMIN',
    username: testData.businessSKpostId,
    password: testData.businessPassword ?? testData.password,
    userType: 'BUSINESS_S',
    tenantId: String(testData.businessSCompanyId),
  },
  {
    key: 'business-m',
    account: 'businessMKpostId',
    role: 'COMPANY_ADMIN',
    username: testData.businessMKpostId,
    password: testData.businessPassword ?? testData.password,
    userType: 'BUSINESS_M',
    tenantId: String(testData.businessMCompanyId),
    // Logs in via plain `userLogin`; the token also authenticates the Admin module.
  },
  {
    key: 'business-l',
    account: 'businessLKpostId',
    role: 'COMPANY_ADMIN',
    username: testData.businessLKpostId,
    password: testData.businessPassword ?? testData.password,
    userType: 'BUSINESS_L',
    tenantId: String(testData.businessLCompanyId),
  },
  // Owns data the first account must not see, for the cross-resource validators.
  {
    key: 'victim',
    account: 'victimKpostId',
    role: 'USER',
    username: testData.victimKpostId,
    password: testData.password,
    userType: testData.userType,
  },
  // Accounts 3-6: extra PERSONAL identities for group, Copy/Confidential-Copy and multi-recipient tests.
  {
    key: 'personal-3',
    account: 'personal3KpostId',
    role: 'USER',
    username: testData.personal3KpostId,
    password: testData.password,
    userType: 'PERSONAL',
  },
  {
    key: 'personal-4',
    account: 'personal4KpostId',
    role: 'USER',
    username: testData.personal4KpostId,
    password: testData.password,
    userType: 'PERSONAL',
  },
  {
    key: 'personal-5',
    account: 'personal5KpostId',
    role: 'USER',
    username: testData.personal5KpostId,
    password: testData.password,
    userType: 'PERSONAL',
  },
  {
    key: 'personal-6',
    account: 'personal6KpostId',
    role: 'USER',
    username: testData.personal6KpostId,
    password: testData.password,
    userType: 'PERSONAL',
  },
];

/** The principals the bench may log in as; on live, only accounts set explicitly in `.env`. */
export const KPOST_PRINCIPALS: readonly Principal[] = ALL_KPOST_PRINCIPALS.filter(
  (principal) => !env.IS_PRODUCTION || isProvided(principal.account),
).map(({ account: _account, ...principal }) => principal);

export const AUTH_PROFILES: Record<AuthProfile['id'], AuthProfile> = {
  /** The KPost auth service, shared by KPost core, Admin and KMail. */
  kpost: {
    id: 'kpost',
    description: 'KPost: loginRO payload, token at the top-level accessToken',
    loginEndpointId: 'signup-login-user-login',
    loginRequest: (principal) => ({
      body: {
        ...DEVICE,
        // Unique per login (see DEVICE).
        sessionID: randomUUID(),
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
 * The auth profile every endpoint uses: KPost core, Admin and KMail all accept the userLogin token.
 */
export function authProfileFor(): AuthProfile {
  return AUTH_PROFILES.kpost;
}

/** A principal with `role` from a profile, optionally one belonging to a different tenant. */
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
