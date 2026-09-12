import { AUTH_PROFILES } from '@config/auth-profile';
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
  method: 'POST',
  path: '/signupLoginForMediumAndLarge/adminUserLogin',
  summary: 'Log in an administrator of a medium or large business',
  tags: [...LOGIN_TAGS, 'business-tier'],
  destructive: false,
  /*
   * The workbook's sample carries `"password": "0FPnV+OKhDGGXMkQjtj1eQ=="` - base64, where every
   * other login sample is plaintext. Whether this endpoint expects an encrypted password is an
   * open question with the API owner; the plaintext form is sent until it is answered, and the
   * result is reported rather than guessed at.
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
  method: 'POST',
  path: '/v2/signupLogin/generateJWTokens/',
  summary: 'Exchange a refresh token for a new access token',
  tags: [...LOGIN_TAGS, 'token-refresh'],
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
  method: 'POST',
  path: '/v2/signupLogin/userLogout/',
  summary: 'End the current session',
  tags: [...LOGIN_TAGS, 'session'],
  authentication: { required: true },
  /*
   * Ends the session of the very account every other suite logs in with. Run in parallel it would
   * invalidate tokens mid-flight and produce 401s all over the report that look like auth defects.
   * `global` keeps it out of a default run.
   */
  destructive: true,
  sideEffect: 'global',
  request: body(() => ({
    deviceType: 'Web',
    deviceIdentity_Primary: '9f9d6bd8',
    logouttime: new Date().toISOString().replace('T', ' ').slice(0, 19),
  })),
});

export const logoutAllDevicesApi = defineKpostEndpoint({
  id: 'signup-login-logout-all-devices',
  method: 'GET',
  path: '/v2/signupLogin/userLogoutFromAllDevices/',
  summary: 'End every session of the account',
  tags: [...LOGIN_TAGS, 'session'],
  authentication: { required: true },
  // Worse than userLogout: it ends every session, including other testers' and the app's.
  destructive: true,
  sideEffect: 'global',
});

export const setAccessCodeApi = defineKpostEndpoint({
  id: 'signup-login-set-access-code',
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

export const loginApis = [
  userLoginApi,
  adminUserLoginApi,
  generateJwTokensApi,
  activeSessionApi,
  loginHistoryApi,
  userLogoutApi,
  logoutAllDevicesApi,
  setAccessCodeApi,
];
