import { dashboardApis, uncoveredDashboardPaths } from '@api/definitions/kpost/dashboard/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/** Self-tests for the Dashboard module wiring. No HTTP. */
test.describe('KPost Dashboard · module coverage', { tag: '@kpost-api' }, () => {
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

  test('every dashboard endpoint is an authenticated read, and the incremental one stays gated @framework', () => {
    /*
     * Every one of the three is an authenticated READ — that part never changed and is asserted for
     * all of them. What this guard used to add was "…and all three are cleared for live", which was
     * true when written and was deliberately reversed for `dashboard-home-new-msgs`: the incremental
     * refresh needs a REAL `firstMsgID` + ISO `serverTime` from a prior `homeDashboardMsgs` read,
     * and with null markers the backend 500s ("Could not locate named parameter [serverTime]"). A
     * standalone live run of it would file that 500 as a false CRITICAL.
     *
     * So the demotion is PINNED rather than erased: it must stay off live AND carry the `needs-id`
     * tag and the note explaining why, and its two siblings must stay cleared. Re-promoting it
     * silently — the change that would reintroduce the false CRITICAL — fails here.
     */
    for (const api of dashboardApis) {
      expect(api.authentication?.required, `${api.id} authenticated`).toBe(true);
      expect(api.destructive ?? false, `${api.id} is a read`).toBe(false);
    }

    const incremental = dashboardApis.find((api) => api.id === 'dashboard-home-new-msgs');
    expect(incremental, 'the incremental refresh is still registered').toBeTruthy();
    expect(
      incremental?.productionSafe ?? false,
      'it needs a runtime marker, so not standalone',
    ).toBe(false);
    /*
     * The tag, not the `note`: `note` is a `KpostEndpointConfig` field that `buildDefinition` does
     * not copy onto the `EndpointDefinition`, so it never reaches the registry (or the report its
     * own doc-comment promises). `needs-id` is what actually travels, and it is what the live
     * coverage generator reads to classify the endpoint.
     */
    expect(incremental?.tags, 'and says so by tag, not only in prose').toContain('needs-id');

    for (const api of dashboardApis.filter((api) => api.id !== 'dashboard-home-new-msgs')) {
      expect(api.productionSafe, `${api.id} reads the latest page with null markers`).toBe(true);
    }
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = dashboardApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
