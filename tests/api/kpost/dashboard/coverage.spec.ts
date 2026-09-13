import { dashboardApis, uncoveredDashboardPaths } from '@api/definitions/kpost/dashboard/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/** Self-tests for the Dashboard module wiring. No HTTP. */
test.describe('KPost Dashboard · module coverage', () => {
  test('every documented dashboard endpoint has a definition @framework', () => {
    expect(uncoveredDashboardPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of dashboardApis) {
      expect(workbookContract('kpost-api', api.method, api.path).path, `${api.id} path`).toBe(
        api.path,
      );
    }
  });

  test('every dashboard endpoint is an authenticated read cleared for live @framework', () => {
    for (const api of dashboardApis) {
      expect(api.authentication?.required, `${api.id} authenticated`).toBe(true);
      expect(api.destructive ?? false, `${api.id} is a read`).toBe(false);
      expect(api.productionSafe, `${api.id} cleared for live`).toBe(true);
    }
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = dashboardApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
