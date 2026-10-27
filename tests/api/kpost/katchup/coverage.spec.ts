import { katchupApis, uncoveredKatchupPaths } from '@api/definitions/kpost/katchup/index';
import { workbookContract } from '@api/contract/workbook-contract';
import {
  KATCHUP_MESSAGE_TYPE,
  KATCHUP_SHARE_TYPE,
  KATCHUP_STATUS,
} from '@api/contract/kpost-types';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/**
 * Katchup module self-tests (no HTTP): coverage, contract agreement, pinned enum codes, and every
 * send authenticated and gated.
 */
test.describe('KPost Katchup · module coverage', () => {
  test('every documented katchup endpoint has a definition @framework', () => {
    expect(uncoveredKatchupPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of katchupApis) {
      // Taken from the live frontend, not the workbook: nothing to cross-check against.
      if ((api.tags ?? []).includes('undocumented-contract')) continue;
      const documented = api.contractPath ?? api.path;
      expect(workbookContract('kpost-api', api.method, documented).path, `${api.id} path`).toBe(
        documented,
      );
    }
  });

  test('every Katchup endpoint requires a token @framework', () => {
    // The whole module is post-login. A public Katchup endpoint would be a real defect.
    const publicOnes = katchupApis
      .filter((api) => api.authentication?.required === false)
      .map((api) => api.id);
    expect(publicOnes, 'Katchup is entirely authenticated').toEqual([]);
  });

  test('the message-type, status and share-type codes match the analysis @framework', () => {
    // Pins the codes (docs/modules/katchup-flow.md §1) so a workbook renumbering fails here.
    expect(KATCHUP_STATUS.sent).toBe(0);
    expect(KATCHUP_STATUS.group).toBe(4);
    expect(KATCHUP_MESSAGE_TYPE.normalMessage).toBe(0);
    expect(KATCHUP_MESSAGE_TYPE.copiesMessage).toBe(14);
    expect(KATCHUP_MESSAGE_TYPE.forwardMessageReveal).toBe(15);
    expect(KATCHUP_MESSAGE_TYPE.forwardMessageHidden).toBe(16);
    expect(KATCHUP_MESSAGE_TYPE.secretMessage).toBe(18);
    expect(KATCHUP_MESSAGE_TYPE.bulkMessage).toBe(19);
    expect(KATCHUP_SHARE_TYPE.forwardMessage).toBe(15);
  });

  test('no send or message-mutating endpoint is cleared for the live application @framework', () => {
    // A productionSafe write would let a live run write to a real conversation.
    const cleared = katchupApis
      .filter((api) => api.destructive && api.productionSafe)
      .map((api) => api.id);
    expect(
      cleared,
      'no Katchup write is cleared for live yet (docs/modules/katchup-flow.md §5-6)',
    ).toEqual([]);
  });

  test('every read cleared for live owns nothing it was not given @framework', () => {
    // productionSafe may only be set on reads (the guard checks payloads at runtime).
    const badClears = katchupApis
      .filter((api) => api.productionSafe && api.destructive)
      .map((api) => api.id);
    expect(badClears, 'a cleared Katchup endpoint must be a read').toEqual([]);
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = katchupApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
