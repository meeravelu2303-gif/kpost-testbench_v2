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
    /*
     * If this id ever stops matching a real definition, every authenticated endpoint in the bench
     * fails with "endpoint not registered" instead of a useful message.
     */
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
    /*
     * `userLogoutFromAllDevices` also ends the owner's own manual sessions on these accounts;
     * `setAccessCode` changes a credential. Neither is scoped to the bench, so both stay `global`.
     */
    for (const id of ['signup-login-logout-all-devices', 'signup-login-set-access-code']) {
      const api = signupLoginApis.find((candidate) => candidate.id === id);
      expect(api?.sideEffect, `${id} must stay global`).toBe('global');
      expect(api?.productionSafe ?? false, `${id} must not be cleared for live`).toBe(false);
    }
  });

  test('single-session logout never runs through the shared engine run @framework', () => {
    /*
     * The engine authenticates with the token provider's cached token. If `userLogout` ever lost
     * its `session-ending` tag, `login.spec.ts` would log that shared session out and every later
     * test in the run would report 401 — an outage the bench caused, filed as auth defects.
     */
    const logout = signupLoginApis.find((api) => api.id === 'signup-login-user-logout');
    expect(logout?.tags, 'userLogout is excluded from describeEndpointCases').toContain(
      'session-ending',
    );
    expect(logout?.sideEffect, 'it ends only the session it is sent with').toBe('data');
  });

  test('signup is out of scope, and only the named registration paths are excluded @framework', () => {
    const ids = signupLoginApis.map((api) => api.id);
    for (const removed of [
      'signup-login-signup',
      'signup-login-signup-get',
      'signup-login-admin-registration',
      'signup-login-kpost-id-exist',
      'signup-login-kpost-id-suggestions',
    ]) {
      expect(ids, `${removed} is registration, out of scope`).not.toContain(removed);
    }
    // The login screen's step 1 is NOT signup, whatever its path looks like.
    expect(ids).toContain('signup-login-fetch-user-details');
    expect(SIGNUP_OUT_OF_SCOPE).toHaveLength(5);
  });
});
