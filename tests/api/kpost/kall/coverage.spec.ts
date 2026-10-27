import { kallApis, uncoveredKallPaths } from '@api/definitions/kpost/kall/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { KALL_MODE, KALL_REPEAT_TYPE, KALL_STATUS, KALL_TYPE } from '@api/contract/kpost-types';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { foreignIdentifiers } from '@engine/qa-identifier-guard';
import { expect, test } from '@fixtures';
import { kallReadApis } from '@api/definitions/kpost/kall/read.api';

/**
 * Kall module self-tests (no HTTP): coverage, contract agreement, pinned codes, gated writes, and
 * cleared reads passing the QA-identifier guard.
 */
test.describe('KPost Kall · module coverage', () => {
  test('every documented kall endpoint has a definition @framework', () => {
    expect(uncoveredKallPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of kallApis) {
      const documented = api.contractPath ?? api.path;
      expect(workbookContract('kpost-api', api.method, documented).path, `${api.id} path`).toBe(
        documented,
      );
    }
  });

  test('every Kall endpoint requires a token @framework', () => {
    const publicOnes = kallApis
      .filter((api) => api.authentication?.required === false)
      .map((api) => api.id);
    expect(publicOnes, 'Kall is entirely authenticated').toEqual([]);
  });

  test('the status, type, mode and repeat-type codes match the analysis @framework', () => {
    // Pins the codes (docs/modules/kall-flow.md §1) so a workbook renumbering fails here.
    expect(KALL_STATUS.new).toBe(0);
    expect(KALL_STATUS.connected).toBe(1);
    expect(KALL_STATUS.scheduled).toBe(6);
    expect(KALL_STATUS.rescheduled).toBe(7);
    expect(KALL_STATUS.closed).toBe(8);
    expect(KALL_TYPE.normal).toBe(0);
    expect(KALL_MODE.audio).toBe(0);
    expect(KALL_MODE.video).toBe(1);
    expect(KALL_REPEAT_TYPE.none).toBe(0);
    expect(KALL_REPEAT_TYPE.daily).toBe(1);
  });

  test('no Kall write is cleared for the live application @framework', () => {
    // A productionSafe write would let a live run place a real call or wipe the log.
    const cleared = kallApis
      .filter((api) => api.destructive && api.productionSafe)
      .map((api) => api.id);
    expect(cleared, 'no Kall write is cleared for live (docs/modules/kall-flow.md §5)').toEqual([]);
  });

  test('every cleared read passes the QA-identifier guard on live @framework', async () => {
    // The guard trips on `kall*` keys by default; this proves its exemptions cover these reads' fields.
    const helpers = { call: () => Promise.resolve({} as never), tenantId: '' };
    const reads = kallReadApis.filter((api) => api.productionSafe);
    const specs = await Promise.all(reads.map((api) => Promise.resolve(api.request?.(helpers))));
    const refused = reads
      .map((api, index) => ({
        id: api.id,
        foreign: foreignIdentifiers({ body: specs[index]?.body }).map((offence) => offence.path),
      }))
      .filter((entry) => entry.foreign.length > 0);
    expect(
      refused,
      'a cleared Kall read names an identifier the guard would refuse on live',
    ).toEqual([]);
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = kallApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
