import { dashboardApis, uncoveredDashboardPaths } from '@api/definitions/kpost/dashboard/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/** Self-tests for the Dashboard module wiring. No HTTP. */
test.describe('KPost Dashboard · module coverage', () => {
  test('every documented dashboard endpoint has a definition @framework', () => {
    expect(uncoveredDashboardPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of dashboardApis) {
      expect(workbookContract('kpost-api', api.method, api.path).path, `${api.id} path`).toBe(
        api.path,
      );
    }
  });

  test('every dashboard endpoint is an authenticated read, cleared for live or excused in writing @framework', () => {
    /*
     * The clearance half is asserted as "cleared, OR excluded with a stated reason" rather than as
     * "all cleared".
     *
     * `dashboard-home-new-msgs` is deliberately not cleared: the incremental refresh needs a real
     * `firstMsgID` and ISO `serverTime` from a prior `homeDashboardMsgs` read, and with null
     * markers the backend 500s — which the engine would report as a false CRITICAL against live.
     * Demanding `productionSafe: true` from every endpoint would force that one to either lie or be
     * deleted from the registry, and deleting it is worse: an endpoint the bench does not list is an
     * endpoint nobody notices has gone untested.
     *
     * Requiring a `note` keeps the safety property intact. Nothing can drift out of live coverage
     * silently — an exclusion has to be written down and is readable in the run output.
     */
    for (const api of dashboardApis) {
      expect(api.authentication?.required, `${api.id} authenticated`).toBe(true);
      expect(api.destructive ?? false, `${api.id} is a read`).toBe(false);
      if (api.productionSafe) continue;
      expect(
        api.note ?? '',
        `${api.id} is not cleared for live, so it must carry a note saying why`,
      ).not.toBe('');
    }
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = dashboardApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
