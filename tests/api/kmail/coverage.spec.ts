import { kmailApis, uncoveredKmailPaths } from '@api/definitions/kmail/index';
import { kmailReadApis } from '@api/definitions/kmail/read.api';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { foreignIdentifiers } from '@engine/qa-identifier-guard';
import { expect, test } from '@fixtures';

/**
 * Self-tests for the KMail module (kmail-api suite, host kmail5). No HTTP. The strict
 * "every documented path is covered" assertion is enabled once the write stages land; for now this
 * pins contract agreement, auth, the guard on cleared reads, and the case count.
 */
test.describe('KPost KMail · module coverage', { tag: '@kmail-api' }, () => {
  test('every documented KMail endpoint has a definition @framework', () => {
    expect(uncoveredKmailPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of kmailApis) {
      const documented = api.contractPath ?? api.path;
      expect(workbookContract('kmail-api', api.method, documented).path, `${api.id} path`).toBe(
        documented,
      );
    }
  });

  test('every KMail endpoint requires a token @framework', () => {
    const publicOnes = kmailApis
      .filter((api) => api.authentication?.required === false)
      .map((api) => api.id);
    expect(publicOnes, 'KMail is entirely authenticated').toEqual([]);
  });

  test('no KMail write is cleared for the live application @framework', () => {
    const cleared = kmailApis
      .filter((api) => api.destructive && api.productionSafe)
      .map((api) => api.id);
    expect(cleared, 'no KMail write is cleared for live').toEqual([]);
  });

  test('every cleared read passes the QA-identifier guard on live @framework', async () => {
    const helpers = { call: () => Promise.resolve({} as never), tenantId: '' };
    const reads = kmailReadApis.filter((api) => api.productionSafe);
    const specs = await Promise.all(reads.map((api) => Promise.resolve(api.request?.(helpers))));
    const refused = reads
      .map((api, index) => ({
        id: api.id,
        foreign: foreignIdentifiers({ body: specs[index]?.body }).map((o) => o.path),
      }))
      .filter((e) => e.foreign.length > 0);
    expect(refused, 'a cleared KMail read names an identifier the guard would refuse').toEqual([]);
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = kmailApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((e) => e.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
