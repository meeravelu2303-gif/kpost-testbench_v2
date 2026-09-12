import { commonApis, uncoveredCommonPaths } from '@api/definitions/kpost/common/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/**
 * Self-tests for the common module's coverage. These send no HTTP requests — they assert that the
 * module is fully and honestly wired, which a reviewer would otherwise have to take on trust.
 */
test.describe('KPost common · module coverage', () => {
  test('every documented common endpoint has a definition @framework', () => {
    // Fails the moment a new workbook dump adds a common endpoint nobody has covered.
    expect(uncoveredCommonPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of commonApis) {
      const contract = workbookContract('kpost-api', api.method, api.path);
      expect(contract.path, `${api.id} path`).toBe(api.path);
    }
  });

  test('no endpoint requires a token: the common module is public @framework', () => {
    const requiringAuth = commonApis
      .filter((api) => api.authentication?.required !== false)
      .map((api) => api.id);
    expect(requiringAuth).toEqual([]);
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = commonApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });

  test('endpoints that send or write are marked destructive @framework', () => {
    // A send or a write must be gated, or a default run texts a real person.
    const sending = ['common-send-otp', 'common-send-otp-to-mail', 'common-forgot-password-otp'];
    const writing = [
      'common-forgot-password-update',
      'common-update-company-logo',
      'common-update-flutter-app-version',
      'common-save-enquiry-details',
      'common-save-unsubscriber-details',
    ];
    for (const id of [...sending, ...writing]) {
      const api = commonApis.find((candidate) => candidate.id === id);
      expect(api, `${id} is registered`).toBeDefined();
      expect(api?.destructive, `${id} must be destructive`).toBe(true);
    }
  });
});
