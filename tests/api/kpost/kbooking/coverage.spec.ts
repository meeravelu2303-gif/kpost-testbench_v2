import { kbookingApis, uncoveredKBookingPaths } from '@api/definitions/kpost/kbooking/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/** Self-tests for the KBooking module wiring. No HTTP. */
test.describe('KPost KBooking · module coverage', () => {
  test('every documented, frontend-active redbus endpoint has a definition @framework', () => {
    // Every documented path has a definition, including three the web app never calls
    // (boardingPoint, tripdetailsV2, updatecitylist).
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
    // Each endpoint is productionSafe OR excluded with a written note (e.g. blockTicket).
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
