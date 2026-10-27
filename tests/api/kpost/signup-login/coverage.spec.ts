import { workbookContract } from '@api/contract/workbook-contract';
import {
  SIGNUP_OUT_OF_SCOPE,
  signupLoginApis,
  uncoveredSignupLoginPaths,
} from '@api/definitions/kpost/signup-login/index';
import { AUTH_PROFILES } from '@config/auth-profile';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/** Self-tests for the module's wiring. No HTTP: these assert what a reviewer would have to trust. */
test.describe('KPost Signup & Login · module coverage', () => {
  test('every documented signupLogin endpoint has a definition @framework', () => {
    expect(uncoveredSignupLoginPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of signupLoginApis) {
      expect(workbookContract('kpost-api', api.method, api.path).path, `${api.id} path`).toBe(
        api.path,
      );
    }
  });

  test('the auth profile logs in at a registered endpoint @framework', () => {
    // Otherwise every authenticated endpoint fails with "endpoint not registered".
    const loginId = AUTH_PROFILES.kpost.loginEndpointId;
    expect(
      signupLoginApis.map((api) => api.id),
      `${loginId} is the endpoint the token provider uses`,
    ).toContain(loginId);
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = signupLoginApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });

  test('endpoints that change a credential or end other sessions stay blocked on live @framework', () => {
    // Logout-all also ends the owner's manual sessions; setAccessCode changes a credential.
    for (const id of ['signup-login-logout-all-devices', 'signup-login-set-access-code']) {
      const api = signupLoginApis.find((candidate) => candidate.id === id);
      expect(api?.sideEffect, `${id} must stay global`).toBe('global');
      expect(api?.productionSafe ?? false, `${id} must not be cleared for live`).toBe(false);
    }
  });

  test('single-session logout never runs through the shared engine run @framework', () => {
    // Without the `session-ending` tag, the engine run would log out the shared token and every later
    // test would 401.
    const logout = signupLoginApis.find((api) => api.id === 'signup-login-user-logout');
    expect(logout?.tags, 'userLogout is excluded from describeEndpointCases').toContain(
      'session-ending',
    );
    expect(logout?.sideEffect, 'it ends only the session it is sent with').toBe('data');
  });

  test('signup is in scope, and nothing under /signupLogin is silently excluded @framework', () => {
    // Signup runs on the OTP test gateway, so the registration ids are in scope.
    const ids = signupLoginApis.map((api) => api.id);
    for (const covered of [
      'signup-login-signup',
      'signup-login-signup-get',
      'signup-login-admin-registration',
      'signup-login-kpost-id-exist',
      'signup-login-kpost-id-suggestions',
    ]) {
      expect(ids, `${covered} is in scope on the OTP test gateway`).toContain(covered);
    }

    // The login screen's step 1 is NOT signup, whatever its path looks like.
    expect(ids).toContain('signup-login-fetch-user-details');

    // Must stay empty: adding an entry removes a path from coverage, so it should fail until confirmed.
    expect(
      SIGNUP_OUT_OF_SCOPE,
      'no /signupLogin path is deliberately out of scope; an addition here must be justified',
    ).toEqual([]);
  });
});
