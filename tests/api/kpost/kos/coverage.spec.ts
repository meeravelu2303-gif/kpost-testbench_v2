import { kosApis, uncoveredKosPaths } from '@api/definitions/kpost/kos/index';
import { kosReadApis } from '@api/definitions/kpost/kos/read.api';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { foreignIdentifiers } from '@engine/qa-identifier-guard';
import { expect, test } from '@fixtures';

/**
 * Self-tests for the KOS module. No HTTP — full coverage, contract agreement, that every write is
 * gated, that the metered AI endpoints are `external` (blocked even under allowLiveWrite), and that
 * every cleared read's payload passes the QA-identifier guard.
 */
test.describe('KPost KOS · module coverage', { tag: '@kpost-api' }, () => {
  test('every documented kword/ai endpoint has a definition @framework', () => {
    expect(uncoveredKosPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of kosApis) {
      const documented = api.contractPath ?? api.path;
      expect(workbookContract('kpost-api', api.method, documented).path, `${api.id} path`).toBe(
        documented,
      );
    }
  });

  test('every KOS endpoint requires a token @framework', () => {
    const publicOnes = kosApis
      .filter((api) => api.authentication?.required === false)
      .map((api) => api.id);
    expect(publicOnes, 'KOS is entirely authenticated').toEqual([]);
  });

  test('no KOS write is cleared for the live application @framework', () => {
    const cleared = kosApis
      .filter((api) => api.destructive && api.productionSafe)
      .map((api) => api.id);
    expect(cleared, 'no KOS write is cleared for live').toEqual([]);
  });

  test('the AI generation endpoints are metered and never productionSafe @framework', () => {
    /*
     * They call a real, billed AI service, so they must never run on a default live pass — the cost
     * gate is the `metered` tag plus `productionSafe: false` (the engine never sends them), with the
     * `KOS_AI_LIVE` flag gating the one owner-authorized test that does.
     */
    const ai = kosApis.filter((api) => api.tags?.includes('metered'));
    expect(
      ai.map((api) => api.id).sort(),
      'both AI generation endpoints are tagged metered',
    ).toEqual(['kos-ai-assist', 'kos-ai-chat']);
    expect(
      ai.filter((api) => api.productionSafe).map((api) => api.id),
      'no metered AI endpoint may be productionSafe',
    ).toEqual([]);
  });

  test('every cleared read passes the QA-identifier guard on live @framework', async () => {
    const helpers = { call: () => Promise.resolve({} as never), tenantId: '' };
    const reads = kosReadApis.filter((api) => api.productionSafe);
    const specs = await Promise.all(reads.map((api) => Promise.resolve(api.request?.(helpers))));
    const refused = reads
      .map((api, index) => ({
        id: api.id,
        foreign: foreignIdentifiers({
          body: specs[index]?.body,
          query: specs[index]?.query,
          pathParams: specs[index]?.pathParams,
        }).map((offence) => offence.path),
      }))
      .filter((entry) => entry.foreign.length > 0);
    expect(refused, 'a cleared KOS read names an identifier the guard would refuse').toEqual([]);
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = kosApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
