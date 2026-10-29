import { AUTH_PROFILES, KPOST_DEVICE_IDENTITY } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { typesOnlySchema } from '@api/schema/sample-schema';
import { body, defineKpostEndpoint, defineUndocumentedKpostEndpoint } from '../kpost-endpoint';

/** A representative login body, for deriving a types-only schema (injection targets `kpostID`). */
const loginSampleBody = AUTH_PROFILES.kpost.loginRequest(AUTH_PROFILES.kpost.principals[0]!)
  .body as Record<string, unknown>;

/**
 * Login, session and token endpoints. `userLogin` reuses the auth profile's payload builder, so the
 * token provider and the login tests never drift. Tokens come back at the top level, not in `data`.
 */
const LOGIN_TAGS = ['signup-login', 'login', 'critical'] as const;

export const userLoginApi = defineKpostEndpoint({
  id: 'signup-login-user-login',
  // Live: every token comes from here; logs in our own account only.
  productionSafe: true,
  requirements: ['FR-SL-026', 'NFR-SEC01'],
  method: 'POST',
  path: '/v2/signupLogin/userLogin/',
  summary: 'Exchange KPost credentials for an access token',
  tags: LOGIN_TAGS,
  // Creates a session row only; gating it would leave every module without a token.
  destructive: false,
  // The exact payload the token provider uses, so the two can never drift apart.
  request: () => AUTH_PROFILES.kpost.loginRequest(AUTH_PROFILES.kpost.principals[0]!),
  // Types-only, so injection/XSS target `kpostID`; `injectionMustBeRejected` then requires a 4xx.
  requestSchema: typesOnlySchema(loginSampleBody),
  security: {
    // Tokens belong in this response; everything else is still checked for leaks.
    sensitiveFieldAllowlist: ['accessToken', 'refreshToken'],
    tokenResponsePath: 'accessToken',
    injectionMustBeRejected: true,
  },
});

export const adminUserLoginApi = defineKpostEndpoint({
  id: 'signup-login-admin-user-login',
  requirements: ['FR-SL-026'],
  method: 'POST',
  path: '/signupLoginForMediumAndLarge/adminUserLogin',
  summary: 'Log in an administrator of a medium or large business',
  tags: [...LOGIN_TAGS, 'business-tier'],
  destructive: false,
  // Plaintext password; no `/v2` variant. Gates on tier (BUSINESS_S gets 403 "Not A Admin"), so the
  // primary request uses the BUSINESS_M principal.
  request: () =>
    AUTH_PROFILES.kpost.loginRequest(
      AUTH_PROFILES.kpost.principals.find((p) => p.userType === 'BUSINESS_M') ??
        AUTH_PROFILES.kpost.principals[0]!,
    ),
  security: {
    sensitiveFieldAllowlist: ['accessToken', 'refreshToken'],
    tokenResponsePath: 'accessToken',
    injectionMustBeRejected: true,
  },
});

export const generateJwTokensApi = defineKpostEndpoint({
  id: 'signup-login-generate-jwt',
  // Device-scoped: the refresh token must be redeemed with the same login's own access token, so
  // the full case lives in session-lifecycle.spec.ts.
  requirements: ['FR-SL-026', 'NFR-SEC01'],
  method: 'POST',
  path: '/v2/signupLogin/generateJWTokens/',
  summary: 'Exchange a refresh token for a new access token',
  tags: [...LOGIN_TAGS, 'token-refresh', 'needs-id'],
  note: "device-scoped: needs a runtime refreshToken AND its own login's accessToken as authorization (see session-lifecycle.spec.ts)",
  destructive: false,
  // Logs in first and reads the refresh token from that response.
  request: async (helpers) => {
    const login = await helpers.call<{ refreshToken?: string }>('signup-login-user-login');
    return { body: { refreshToken: login.refreshToken ?? '' } };
  },
  security: {
    sensitiveFieldAllowlist: ['accessToken', 'refreshToken'],
    tokenResponsePath: 'accessToken',
  },
});

export const activeSessionApi = defineKpostEndpoint({
  id: 'signup-login-active-session',
  // A token with no TBL_KPOST_LOGIN_SESSION row cannot be revoked server-side, and no response
  // assertion can see that.
  database: { validations: ['kpost-login-session-created'] },
  // Live: Reads the CALLER'S sessions; the account comes from the token, not a payload.
  productionSafe: true,
  requirements: ['FR-S11'],
  method: 'GET',
  path: '/v2/signupLogin/getActiveSession',
  summary: "List the account's active sessions",
  tags: [...LOGIN_TAGS, 'session'],
  // Reads the caller's own sessions, so it must require a token.
  authentication: { required: true },
  destructive: false,
});

export const loginHistoryApi = defineKpostEndpoint({
  id: 'signup-login-login-history',
  // Live: Reads the CALLER'S history, keyed by a date. Account comes from the token.
  productionSafe: true,
  requirements: ['FR-S11'],
  method: 'POST',
  path: '/v2/signupLogin/getLoginHistory',
  summary: "Login history for the caller's account",
  tags: [...LOGIN_TAGS, 'session'],
  authentication: { required: true },
  destructive: false,
  // The workbook lists date, null or "" in one cell; a date is sent, the null/empty probes try the
  // rest.
  request: body(() => ({ selectedDate: new Date().toISOString().slice(0, 10) })),
  requestSchema: typesOnlySchema({ selectedDate: new Date().toISOString().slice(0, 10) }),
});

export const userLogoutApi = defineKpostEndpoint({
  id: 'signup-login-user-logout',
  requirements: ['FR-S12'],
  method: 'POST',
  path: '/v2/signupLogin/userLogout/',
  summary: 'End the current session',
  // `session-ending` keeps it out of the engine, which would log out the shared cached session.
  // Tested only by login-flow.spec.ts on its own session.
  tags: [...LOGIN_TAGS, 'session', 'session-ending'],
  authentication: { required: true },
  // Live: ends only the session we opened ourselves, on our own account.
  productionSafe: true,
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    deviceType: 'Web',
    // Lower-case `primary`, as the web client sends it; flow tests override it with their own
    // device.
    deviceIdentity_primary: KPOST_DEVICE_IDENTITY,
    logouttime: new Date().toISOString().replace('T', ' ').slice(0, 19),
  })),
});

export const logoutAllDevicesApi = defineKpostEndpoint({
  id: 'signup-login-logout-all-devices',
  requirements: ['FR-S12'],
  method: 'GET',
  path: '/v2/signupLogin/userLogoutFromAllDevices/',
  summary: 'End every session of the account',
  tags: [...LOGIN_TAGS, 'session'],
  authentication: { required: true },
  // Blocked on live: it ends every session of the account, including manual ones.
  destructive: true,
  sideEffect: 'global',
});

export const setAccessCodeApi = defineKpostEndpoint({
  id: 'signup-login-set-access-code',
  requirements: ['FR-S11', 'NFR-SEC03'],
  method: 'POST',
  path: '/v2/signupLogin/setAccessCode',
  summary: "Set the account's access code",
  tags: [...LOGIN_TAGS, 'account-security'],
  authentication: { required: true },
  // Changes a credential on a real account, so it is gated as `global`.
  destructive: true,
  sideEffect: 'global',
  request: body(() => ({
    kpostID: testData.forgotPasswordKpostId,
    currentPassword: testData.password,
    accessCode: '1234',
  })),
});

export const fetchUserDetailsApi = defineKpostEndpoint({
  id: 'signup-login-fetch-user-details',
  // Live: reads OUR OWN account, asked with QA_KPOST_ID.
  productionSafe: true,
  requirements: ['FR-SL-024'],
  method: 'POST',
  path: '/v2/signupLogin/fetchUserDetails/',
  // Step 1 of the login screen: looks up the KPOST ID to show the name card and the userType.
  summary: 'Look up an account by KPOST ID — step 1 of the login screen',
  tags: [...LOGIN_TAGS, 'pii'],
  destructive: false,
  // Public and returns a name from a KPOST ID alone: an enumeration surface the central validators
  // check.
  request: body(() => ({ kpostID: testData.kpostId, countryID: testData.countryId })),
});

export const fetchPersonalUserDetailsApi = defineUndocumentedKpostEndpoint({
  id: 'signup-login-fetch-personal-user-details',
  // Live: a public lookup of OUR own account (the QA identifier guard checks it).
  productionSafe: true,
  method: 'POST',
  path: '/v2/signupLogin/fetchPersonalUserDetails',
  summary: 'Name, designation and type of an active personal account, by KPost ID or mobile',
  tags: ['signup-login', 'signup', 'enumeration-surface', 'security'],
  authentication: { required: false },
  destructive: false,
  request: body(() => ({ kpostID: testData.kpostId, countryID: String(testData.countryId) })),
  requestSchema: typesOnlySchema({
    kpostID: testData.kpostId,
    countryID: String(testData.countryId),
  }),
  evidence:
    'SignUpLoginControllerV2.java:405 (public under /v2/signupLogin/**); SignUpLoginDaoImpl.java:774-784 ' +
    'matches kpostID OR mobileNumber; no client calls it',
  note:
    'security defect candidate: no token, and the "kpostID" may be a mobile number, so anyone can look ' +
    'up a person by phone; an unknown user answers 500, not 404 (getSingleResult) — verify live',
});

export const loginApis = [
  fetchPersonalUserDetailsApi,
  fetchUserDetailsApi,
  userLoginApi,
  adminUserLoginApi,
  generateJwTokensApi,
  activeSessionApi,
  loginHistoryApi,
  userLogoutApi,
  logoutAllDevicesApi,
  setAccessCodeApi,
];
