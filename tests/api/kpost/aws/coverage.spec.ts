import { awsApis, uncoveredAwsPaths } from '@api/definitions/kpost/aws/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { foreignIdentifiers } from '@engine/qa-identifier-guard';
import { expect, test } from '@fixtures';

/**
 * Self-tests for the AWS module. No HTTP — full coverage, contract agreement, that the delete is
 * gated, and that the cleared presigned generators pass the QA-identifier guard.
 */
test.describe('KPost AWS · module coverage', { tag: '@kpost-api' }, () => {
  test('every documented aws endpoint has a definition @framework', () => {
    expect(uncoveredAwsPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of awsApis) {
      const documented = api.contractPath ?? api.path;
      expect(workbookContract('kpost-api', api.method, documented).path, `${api.id} path`).toBe(
        documented,
      );
    }
  });

  test('every AWS endpoint requires a token @framework', () => {
    const publicOnes = awsApis
      .filter((api) => api.authentication?.required === false)
      .map((api) => api.id);
    expect(publicOnes, 'AWS is entirely authenticated').toEqual([]);
  });

  test('the attachment delete is not cleared for live @framework', () => {
    const cleared = awsApis
      .filter((api) => api.destructive && api.productionSafe)
      .map((api) => api.id);
    expect(cleared, 'the S3 delete must not run on a default live pass').toEqual([]);
  });

  test('every cleared presigned generator passes the QA-identifier guard @framework', async () => {
    const helpers = { call: () => Promise.resolve({} as never), tenantId: '' };
    const reads = awsApis.filter((api) => api.productionSafe);
    const specs = await Promise.all(reads.map((api) => Promise.resolve(api.request?.(helpers))));
    const refused = reads
      .map((api, index) => ({
        id: api.id,
        foreign: foreignIdentifiers({ body: specs[index]?.body }).map((offence) => offence.path),
      }))
      .filter((entry) => entry.foreign.length > 0);
    expect(refused, 'a cleared AWS generator names an identifier the guard would refuse').toEqual(
      [],
    );
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = awsApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
