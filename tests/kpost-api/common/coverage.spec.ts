import { commonApis, uncoveredCommonPaths } from '@api/definitions/kpost/common/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/** Self-tests (no HTTP) that the common module is fully wired. */
test.describe('KPost common · module coverage', () => {
  test('every documented common endpoint has a definition @framework', () => {
    // Fails the moment a new workbook dump adds a common endpoint nobody has covered.
    expect(uncoveredCommonPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of commonApis) {
      // `contractPath` is the documented row when the live path differs from the sheet.
      const documented = api.contractPath ?? api.path;
      const contract = workbookContract('kpost-api', api.method, documented);
      expect(contract.path, `${api.id} contract path`).toBe(documented);
    }
  });

  /**
   * Common is public except the company-logo trio (per the API owner's curls; this gateway answers
   * 401 to any unrouted path, so a 401 proves nothing). Exact list, so any change fails the test.
   */
  const REQUIRES_TOKEN = [
    'common-download-company-logo',
    'common-update-company-logo',
    'common-remove-company-logo',
  ];

  test('the common module is public, except the endpoints listed here @framework', () => {
    const requiringAuth = commonApis
      .filter((api) => api.authentication?.required !== false)
      .map((api) => api.id);
    expect(requiringAuth.sort()).toEqual([...REQUIRES_TOKEN].sort());
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
