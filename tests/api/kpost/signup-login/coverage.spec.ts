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
test.describe('KPost Signup & Login · module coverage', { tag: '@kpost-api' }, () => {
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

  test('registration is in scope, and every account-minting write stays OTP-gated @framework', () => {
    /*
     * This guard used to assert the OPPOSITE — that the five registration endpoints were absent and
     * `SIGNUP_OUT_OF_SCOPE` named all five. That was true when it was written and was reversed on
     * 2026-09-19, when the owner confirmed testingapi's OTP subsystem is a TEST GATEWAY and signup
     * was re-added (CLAUDE.md §8; the list's own comment in `signup-login/index.ts` says so). The
     * guard never ran — every hand-written api spec was dropped by the suite tag filter — so it kept
     * asserting a retired decision.
     *
     * What matters is NOT whether registration is registered; it is that the two endpoints which
     * MINT A PERMANENT ACCOUNT can never run casually. An account cannot be deleted on this product,
     * so a stray registration is permanent. That property is what is pinned here, and it is stricter
     * than "these ids must be absent" ever was: the ids may exist, but only behind the OTP gateway,
     * as a destructive global write the production guard blocks by default.
     */
    const ids = signupLoginApis.map((api) => api.id);
    const byId = (id: string) => signupLoginApis.find((api) => api.id === id);

    for (const id of ['signup-login-signup', 'signup-login-admin-registration']) {
      const api = byId(id);
      expect(api, `${id} is registered (signup came back into scope on 2026-09-19)`).toBeTruthy();
      expect(api?.otpDependent, `${id} needs an OTP it cannot obtain outside the gateway`).toBe(
        'requires',
      );
      expect(api?.destructive, `${id} mints a permanent account`).toBe(true);
      expect(api?.sideEffect, `${id} touches shared, unremovable state`).toBe('global');
      expect(api?.productionSafe ?? false, `${id} is never cleared for a standalone live run`).toBe(
        false,
      );
    }

    // The availability lookups are reads: they answer "is this id free?" and create nothing.
    for (const id of [
      'signup-login-signup-get',
      'signup-login-kpost-id-exist',
      'signup-login-kpost-id-suggestions',
    ]) {
      expect(byId(id)?.destructive ?? false, `${id} is an availability read`).toBe(false);
    }

    // The login screen's step 1 is NOT signup, whatever its path looks like.
    expect(ids).toContain('signup-login-fetch-user-details');
    // Nothing under /signupLogin is deliberately excluded any more; the list stays as the hook that
    // makes a NEW uncovered path fail rather than be swallowed (see uncoveredSignupLoginPaths).
    expect(SIGNUP_OUT_OF_SCOPE, 'no signupLogin path is deliberately out of scope').toEqual([]);
  });
});
