import { katchupApis, uncoveredKatchupPaths } from '@api/definitions/kpost/katchup/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { KATCHUP_MESSAGE_TYPE, KATCHUP_SHARE_TYPE, KATCHUP_STATUS } from '@api/schemas/kpost-types';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/**
 * Self-tests for the Katchup module. No HTTP — these assert the wiring a reviewer would otherwise
 * take on trust: full coverage, contract agreement, that the enum codes still mean what
 * `docs/katchup-flow.md` says, and that every send is authenticated and gated.
 */
test.describe('KPost Katchup · module coverage', () => {
  test('every documented katchup endpoint has a definition @framework', () => {
    expect(uncoveredKatchupPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of katchupApis) {
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
    /*
     * Pins the codes the payloads use against the owner's definitions (docs/katchup-flow.md §1). A
     * workbook edit that renumbered them would fail here rather than silently change what a send
     * means.
     */
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
    /*
     * Sends reach a real inbox and mutations act on a real message; both wait on the owner's
     * sign-off and on real message ids. If one were ever marked productionSafe, a live run would
     * write to a real conversation. This is the assertion that stops that.
     */
    const cleared = katchupApis
      .filter((api) => api.destructive && api.productionSafe)
      .map((api) => api.id);
    expect(cleared, 'no Katchup write is cleared for live yet (docs/katchup-flow.md §5-6)').toEqual(
      [],
    );
  });

  test('every read cleared for live owns nothing it was not given @framework', () => {
    /*
     * The reads marked productionSafe must be reads (not destructive). The identifier guard checks
     * the built payload at runtime; this checks the flag itself is only on reads.
     */
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
