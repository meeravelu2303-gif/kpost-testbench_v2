import { commonApis, uncoveredCommonPaths } from '@api/definitions/kpost/common/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/**
 * Self-tests for the common module's coverage. These send no HTTP requests — they assert that the
 * module is fully and honestly wired, which a reviewer would otherwise have to take on trust.
 */
test.describe('KPost common · module coverage', { tag: '@kpost-api' }, () => {
  test('every documented common endpoint has a definition @framework', () => {
    // Fails the moment a new workbook dump adds a common endpoint nobody has covered.
    expect(uncoveredCommonPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of commonApis) {
      /*
       * `contractPath` where the live API disagrees with the sheet: the schema still comes from the
       * documented row, but the request goes to the real path. Asserting only `api.path` would make
       * a corrected endpoint fail this test for being correct.
       */
      const documented = api.contractPath ?? api.path;
      const contract = workbookContract('kpost-api', api.method, documented);
      expect(contract.path, `${api.id} contract path`).toBe(documented);
    }
  });

  /**
   * The common module is public except for the company-logo trio, which the API owner's working
   * calls confirm require a Bearer token.
   *
   * An exact list, so an endpoint that starts *or* stops requiring a token fails this test rather
   * than changing the module's security posture silently.
   *
   * One earlier claim here was wrong and is worth remembering: the bench cited a 401 as proof that
   * `downloadCompanyLogo` was protected. This gateway answers 401 to *any* unrouted path without a
   * token, so that proved nothing - the route was simply absent at the path the workbook gave. The
   * authority for these three is the owner's curl, not our probe.
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
