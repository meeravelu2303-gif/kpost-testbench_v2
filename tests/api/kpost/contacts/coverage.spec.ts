import { contactsApis, uncoveredContactsPaths } from '@api/definitions/kpost/contacts/index';
import { contactsReadApis } from '@api/definitions/kpost/contacts/read.api';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { foreignIdentifiers } from '@engine/qa-identifier-guard';
import { expect, test } from '@fixtures';

/**
 * Self-tests for the Contacts module. No HTTP — full coverage, contract agreement, that every write
 * is gated, and — the one that matters on live — that every cleared read's payload passes the
 * QA-identifier guard.
 */
test.describe('KPost Contacts · module coverage', { tag: '@kpost-api' }, () => {
  test('every documented contacts endpoint has a definition @framework', () => {
    expect(uncoveredContactsPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of contactsApis) {
      const documented = api.contractPath ?? api.path;
      expect(workbookContract('kpost-api', api.method, documented).path, `${api.id} path`).toBe(
        documented,
      );
    }
  });

  test('every Contacts endpoint requires a token @framework', () => {
    const publicOnes = contactsApis
      .filter((api) => api.authentication?.required === false)
      .map((api) => api.id);
    expect(publicOnes, 'Contacts is entirely authenticated').toEqual([]);
  });

  test('no Contacts write is cleared for the live application @framework', () => {
    const cleared = contactsApis
      .filter((api) => api.destructive && api.productionSafe)
      .map((api) => api.id);
    expect(cleared, 'no Contacts write is cleared for live').toEqual([]);
  });

  test('every cleared read passes the QA-identifier guard on live @framework', async () => {
    const helpers = { call: () => Promise.resolve({} as never), tenantId: '' };
    const reads = contactsReadApis.filter((api) => api.productionSafe);
    const specs = await Promise.all(reads.map((api) => Promise.resolve(api.request?.(helpers))));
    const refused = reads
      .map((api, index) => ({
        id: api.id,
        foreign: foreignIdentifiers({ body: specs[index]?.body }).map((offence) => offence.path),
      }))
      .filter((entry) => entry.foreign.length > 0);
    expect(
      refused,
      'a cleared Contacts read names an identifier the guard would refuse on live',
    ).toEqual([]);
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = contactsApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
