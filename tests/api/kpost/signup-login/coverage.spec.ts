import { workbookContract } from '@api/contract/workbook-contract';
import {
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

  test('session-ending and account-creating endpoints are gated @framework', () => {
    // Logging the shared QA account out mid-run would produce 401s that look like auth defects.
    const gated = {
      'signup-login-user-logout': 'global',
      'signup-login-logout-all-devices': 'global',
      'signup-login-set-access-code': 'global',
      'signup-login-admin-registration': 'global',
      'signup-login-signup': 'data',
    } as const;
    for (const [id, sideEffect] of Object.entries(gated)) {
      const api = signupLoginApis.find((candidate) => candidate.id === id);
      expect(api?.destructive, `${id} must be destructive`).toBe(true);
      expect(api?.sideEffect, `${id} side effect`).toBe(sideEffect);
    }
  });
});
