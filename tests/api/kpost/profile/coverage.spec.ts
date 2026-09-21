import { profileApis, uncoveredProfilePaths } from '@api/definitions/kpost/profile/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/** Self-tests for the Profile module wiring. No HTTP. */
test.describe('KPost Profile · module coverage', { tag: '@kpost-api' }, () => {
  test('every documented profile endpoint has a definition @framework', () => {
    expect(uncoveredProfilePaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of profileApis) {
      const documented = api.contractPath ?? api.path;
      // `contractMethod` where the live verb differs from the documented one (fetchUserDetails,
      // isDevicePrimaryOrNot): the schema still comes from the documented method+path row.
      const method = api.contractMethod ?? api.method;
      expect(workbookContract('kpost-api', method, documented).path, `${api.id} path`).toBe(
        documented,
      );
    }
  });

  test('every profile endpoint requires a token except public recovery @framework', () => {
    // forgotPasswordOrKpostID is the only public entry (account recovery); everything else is post-login.
    const publicOnes = profileApis
      .filter((api) => api.authentication?.required === false)
      .map((api) => api.id);
    expect(publicOnes).toEqual(['profile-forgot-password-or-kpostid']);
  });

  test('no profile write is cleared for the live application @framework', () => {
    // Every write touches our own profile or account; live writes run only via an authorized flow.
    const cleared = profileApis
      .filter((api) => api.destructive && api.productionSafe)
      .map((api) => api.id);
    expect(cleared, 'no profile write is productionSafe').toEqual([]);
  });

  test('the account-destroying endpoints are OTP-gated and global @framework', () => {
    // deactivateAccount and the device-designation writes must be doubly blocked on live.
    for (const id of ['profile-deactivate-account', 'profile-set-device-primary']) {
      const api = profileApis.find((candidate) => candidate.id === id);
      expect(api?.sideEffect, `${id} side effect`).toBe('global');
      expect(api?.otpDependent, `${id} is OTP-gated`).toBeTruthy();
    }
    // changePassword would lock the QA account out — global, never cleared.
    const pw = profileApis.find((api) => api.id === 'profile-change-password');
    expect(pw?.sideEffect).toBe('global');
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = profileApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
