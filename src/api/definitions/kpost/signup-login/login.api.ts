import { AUTH_PROFILES, KPOST_DEVICE_IDENTITY } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { body, defineKpostEndpoint } from '../kpost-endpoint';

/**
 * Login, session and token endpoints — the gate to the entire product.
 *
 * ## Why this file matters more than its size suggests
 *
 * `userLogin` is where every other module's token comes from. Its definition is referenced by
 * `AUTH_PROFILES.kpost.loginEndpointId`, so the payload lives in exactly one place: the auth
 * profile builds it for the token provider, and this definition reuses that same builder for its
 * own happy path. If the login contract changes, one edit fixes both the tests of login and the
 * authentication of every endpoint that needs a token.
 *
 * ## What the live API does, measured
 *
 * A successful login answers 200 with the tokens at the **top level**, not inside `data`:
 *
 *     { "statusCode": 200, "status": "SUCCESS", "message": "Login SuccessFully",
 *       "accessToken": "…", "refreshToken": "…", "isFirstTimeLogin": false,
 *       "isPrimaryDevice": false, "data": { "kpostID": …, "userType": "PERSONAL", … } }
 *
 * A **failed** login answers **HTTP 500** with `"Invalid Credential"` — for a wrong password and
 * for the wrong `userType` alike. That is the single most common client error on the most
 * security-sensitive endpoint in the product, and 500 is the wrong answer: it pages whoever owns
 * the alerts and it tells a caller nothing. The expected statuses below therefore stay `[200]`,
 * so the bench keeps reporting it until it is fixed.
 */
const LOGIN_TAGS = ['signup-login', 'login', 'critical'] as const;

export const userLoginApi = defineKpostEndpoint({
  id: 'signup-login-user-login',
  // Live: Essential: every token comes from here. Logs in OUR account only.
  // It creates a session row, which is what a login does - it changes nothing a customer owns.
  productionSafe: true,
  requirements: ['FR-SL-026', 'NFR-SEC01'],
  method: 'POST',
  path: '/v2/signupLogin/userLogin/',
  summary: 'Exchange KPost credentials for an access token',
  tags: LOGIN_TAGS,
  /*
   * A login creates a session row and can mark a device as known, but it changes nothing a test
   * relies on, and gating it would leave every other module without a token.
   */
  destructive: false,
  // The exact payload the token provider uses, so the two can never drift apart.
  request: () => AUTH_PROFILES.kpost.loginRequest(AUTH_PROFILES.kpost.principals[0]!),
  security: {
    /*
     * The tokens are supposed to be in the response, so the sensitive-data validator must not
     * flag them - but it still checks that nothing else leaks, and the JWT validator now has a
     * token to inspect (signed, expiring, no secrets in the claims).
     */
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
  /*
   * ## Two questions answered by probing this endpoint
   *
   * **The password is plaintext.** The workbook's sample carries
   * `"password": "0FPnV+OKhDGGXMkQjtj1eQ=="` - base64, where every other login sample is plain -
   * but `Qa@Passw0rd123` is accepted with 200. No encryption is required.
   *
   * **There is no `/v2` variant.** `/v2/signupLoginForMediumAndLarge/adminUserLogin` answers
   * `401 "Authentication is required"`, which is what this gateway returns for any path it cannot
   * route. The workbook's path is the real one - unlike the logo routes, where the sheet had
   * dropped the prefix.
   *
   * ## It gates on the TIER, not the role - and says the wrong thing about it
   *
   *     BUSINESS_M  -> 200
   *     BUSINESS_L  -> 200
   *     BUSINESS_S  -> 403 "Not A Admin"
   *
   * `meera@m960s.kpost.in` is stored in the database with `role = admin`, so "Not A Admin" is
   * false. Rejecting a Small business may well be intended - the endpoint is named
   * *ForMediumAndLarge* - but then the message describes the wrong thing, and an integrator reading
   * it will go looking for a permissions problem that does not exist. One of the two is a defect:
   * either the tier check should accept an admin of a Small business, or the message should say the
   * login is for Medium and Large enterprises. The owner decides which; the bench reports it.
   *
   * The primary request uses the BUSINESS_M principal, since Small is rejected by design.
   */
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
  /*
   * Exchanges a refresh token for a new access token. Live-verified 2026-09-24 (corrects the prior
   * note here): the login response DOES expose a `refreshToken` — but only on a login that runs on
   * its OWN fresh device id, not the shared cached session every other test in a run reuses (whose
   * accessToken belongs to a different device). And redeeming it is device-scoped: the caller must
   * be authorized with THAT SAME login's own accessToken — authorizing with the shared cached
   * principal token instead (a different device) is correctly refused with 401 "UNAUTHORIZED USER".
   * See `tests/api/kpost/signup-login/session-lifecycle.spec.ts` for both branches, driven from a
   * dedicated device-scoped login rather than this `helpers.call` chain (which reuses the shared
   * session and so cannot observe the same-device case).
   */
  requirements: ['FR-SL-026', 'NFR-SEC01'],
  method: 'POST',
  path: '/v2/signupLogin/generateJWTokens/',
  summary: 'Exchange a refresh token for a new access token',
  tags: [...LOGIN_TAGS, 'token-refresh', 'needs-id'],
  note: 'device-scoped: needs a runtime refreshToken AND its own login\'s accessToken as authorization (see session-lifecycle.spec.ts)',
  destructive: false,
  /*
   * Needs a real refresh token, which only a login produces. `helpers.call` runs the login
   * endpoint first and reads the refresh token out of its response - the same mechanism the
   * framework uses for "create, then fetch" chains, so no token is ever hard-coded.
   */
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
  /*
   * The workbook documents the payload as `{"selectedDate": "2025-07-30" or null or ""}` - three
   * alternatives in one cell, so no schema could be inferred. A concrete date is sent; the null
   * and empty-string variants are what the central null-value and empty-value probes already try.
   */
  request: body(() => ({ selectedDate: new Date().toISOString().slice(0, 10) })),
});

export const userLogoutApi = defineKpostEndpoint({
  id: 'signup-login-user-logout',
  requirements: ['FR-S12'],
  method: 'POST',
  path: '/v2/signupLogin/userLogout/',
  summary: 'End the current session',
  /*
   * `session-ending` keeps this out of `describeEndpointCases`. The engine authenticates with the
   * token provider's CACHED token — the one every later test in the run reuses — so a primary call
   * here would log that session out and turn the rest of the report into 401s that look like auth
   * defects. It is exercised only by `login-flow.spec.ts`, on a session opened for that test.
   */
  tags: [...LOGIN_TAGS, 'session', 'session-ending'],
  authentication: { required: true },
  /*
   * Live: ends ONLY the session named by the token and device it is sent with — one we opened
   * ourselves, on our own account. That is a write the test owns (`data`), not shared state, and
   * it carries no identifier the QA guard could mistake for somebody else's. Contrast
   * `userLogoutFromAllDevices` below, which stays blocked.
   */
  productionSafe: true,
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    deviceType: 'Web',
    /*
     * Lower-case `primary`, as the web client's own logout sends it (Header.js `handleLogout`). The
     * workbook's sample spells it `deviceIdentity_Primary`; the working client is the better
     * evidence of what the server reads. Flow tests override the value with their session's device.
     */
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
  /*
   * Blocked on live. It ends EVERY session of the account — including the owner's own manual
   * sessions on these QA accounts in the browser or the mobile app — and nothing in the request
   * scopes it to the bench. `userLogout` above proves FR-S12 without that collateral.
   */
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
  /*
   * Changes a credential on a real account, and takes `currentPassword` - so a caller who can set
   * an access code without proving the current password owns the account. Gated as `global`.
   */
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
  /*
   * Step 1 of the login SCREEN, not a signup endpoint: the web client calls it when the user enters
   * a KPOST ID and presses Submit (Login.js `handleSubmit` -> `FetchKpostIDDetails`), and uses the
   * answer to show the name card and to learn the account's userType for step 2. So it belongs to
   * login, and it stays when signup is out of scope.
   */
  summary: 'Look up an account by KPOST ID — step 1 of the login screen',
  tags: [...LOGIN_TAGS, 'pii'],
  destructive: false,
  /*
   * Public, and it returns somebody's name from their KPOST ID alone. Legitimate for a login form;
   * also an enumeration and PII surface, which the central information-disclosure and sensitive-data
   * validators examine.
   */
  request: body(() => ({ kpostID: testData.kpostId, countryID: testData.countryId })),
});

export const loginApis = [
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
