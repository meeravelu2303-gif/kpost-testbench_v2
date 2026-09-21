import { kdiaryApis, uncoveredKdiaryPaths } from '@api/definitions/kpost/kdiary/index';
import { kdiaryReadApis } from '@api/definitions/kpost/kdiary/read.api';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { foreignIdentifiers } from '@engine/qa-identifier-guard';
import { expect, test } from '@fixtures';

/**
 * Self-tests for the KDiary module. No HTTP — full coverage, contract agreement, that every write is
 * gated, and that every cleared read's payload passes the QA-identifier guard on live.
 */
test.describe('KPost KDiary · module coverage', { tag: '@kpost-api' }, () => {
  test('every documented dairySchedule endpoint has a definition @framework', () => {
    expect(uncoveredKdiaryPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of kdiaryApis) {
      const documented = api.contractPath ?? api.path;
      expect(workbookContract('kpost-api', api.method, documented).path, `${api.id} path`).toBe(
        documented,
      );
    }
  });

  test('every KDiary endpoint requires a token @framework', () => {
    const publicOnes = kdiaryApis
      .filter((api) => api.authentication?.required === false)
      .map((api) => api.id);
    expect(publicOnes, 'KDiary is entirely authenticated').toEqual([]);
  });

  test('no KDiary write is cleared for the live application @framework', () => {
    const cleared = kdiaryApis
      .filter((api) => api.destructive && api.productionSafe)
      .map((api) => api.id);
    expect(cleared, 'no KDiary write is cleared for live').toEqual([]);
  });

  test('every cleared read passes the QA-identifier guard on live @framework', async () => {
    const helpers = { call: () => Promise.resolve({} as never), tenantId: '' };
    const reads = kdiaryReadApis.filter((api) => api.productionSafe);
    const specs = await Promise.all(reads.map((api) => Promise.resolve(api.request?.(helpers))));
    const refused = reads
      .map((api, index) => ({
        id: api.id,
        foreign: foreignIdentifiers({ body: specs[index]?.body }).map((offence) => offence.path),
      }))
      .filter((entry) => entry.foreign.length > 0);
    expect(refused, 'a cleared KDiary read names an identifier the guard would refuse').toEqual([]);
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = kdiaryApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
