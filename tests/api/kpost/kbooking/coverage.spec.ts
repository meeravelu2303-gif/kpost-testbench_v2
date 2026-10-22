import { kbookingApis, uncoveredKBookingPaths } from '@api/definitions/kpost/kbooking/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/** Self-tests for the KBooking module wiring. No HTTP. */
test.describe('KPost KBooking · module coverage', () => {
  test('every documented, frontend-active redbus endpoint has a definition @framework', () => {
    /*
     * `boardingPoint`, `tripdetailsV2` and `updatecitylist` have no caller in the web app
     * (docs/scope/unused-endpoints.md), but they are part of the published API, so since 2026-10-22
     * (regression coverage to 100%) every documented redbus path has a definition: the two reads run
     * live in the feature chain, the city-list refresh is a shared write checked off live only.
     */
    expect(uncoveredKBookingPaths(), 'every documented redbus path has a definition').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of kbookingApis) {
      const contractPath = api.contractPath ?? api.path;
      expect(workbookContract('kpost-api', api.method, contractPath).path, `${api.id} path`).toBe(
        contractPath,
      );
    }
  });

  test('every endpoint is cleared for live or excused in writing @framework', () => {
    /*
     * Unlike Dashboard (all reads), KBooking mixes reads with one real third-party write
     * (blockTicket), so the "cleared" half of the claim is "productionSafe, OR excluded with a
     * stated reason" rather than "all reads". A note is mandatory wherever `productionSafe` is
     * false, so nothing can drift out of live coverage silently.
     */
    for (const api of kbookingApis) {
      expect(api.authentication?.required, `${api.id} authenticated`).toBe(true);
      if (api.productionSafe) continue;
      expect(
        api.note ?? '',
        `${api.id} is not cleared for live, so it must carry a note saying why`,
      ).not.toBe('');
    }
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = kbookingApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
