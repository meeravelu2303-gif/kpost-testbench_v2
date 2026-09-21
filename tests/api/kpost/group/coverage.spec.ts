import { groupApis, uncoveredGroupPaths } from '@api/definitions/kpost/group/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/** Self-tests for the Group module wiring. No HTTP. */
test.describe('KPost Group · module coverage', { tag: '@kpost-api' }, () => {
  test('every documented group endpoint has a definition @framework', () => {
    expect(uncoveredGroupPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of groupApis) {
      const documented = api.contractPath ?? api.path;
      expect(workbookContract('kpost-api', api.method, documented).path, `${api.id} path`).toBe(
        documented,
      );
    }
  });

  test('every group endpoint requires a token @framework', () => {
    const publicOnes = groupApis
      .filter((api) => api.authentication?.required === false)
      .map((api) => api.id);
    expect(publicOnes, 'group management is authenticated').toEqual([]);
  });

  test('no group write is cleared for the live application @framework', () => {
    const cleared = groupApis
      .filter((api) => api.destructive && api.productionSafe)
      .map((a) => a.id);
    expect(cleared, 'group writes run only via the authorized feature flow').toEqual([]);
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = groupApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
