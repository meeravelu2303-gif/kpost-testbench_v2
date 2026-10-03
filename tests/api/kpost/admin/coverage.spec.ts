import { adminUserManagementApis } from '@api/definitions/kpost/admin/user-management.api';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/**
 * Self-tests for the core `/admin/*` module (business-tier company administration, inside the
 * `kpost-api` suite — distinct from the separate `admin-api` Admin/HR-Setup microservice, which has
 * its own `coverage.spec.ts`). Every other kpost sub-module has one of these; this one previously
 * rode silently on `common/company.spec.ts`'s `common-company` tag sweep, which happened to include
 * all 12 endpoints but gave this module no dedicated, auditable self-test of its own.
 */
test.describe('KPost core admin (/admin/*) · module coverage', () => {
  test('every definition matches the generated contract @framework', () => {
    for (const api of adminUserManagementApis) {
      const documented = api.contractPath ?? api.path;
      expect(workbookContract('kpost-api', api.method, documented).path, `${api.id} path`).toBe(
        documented,
      );
    }
  });

  test('every endpoint requires a token @framework', () => {
    const publicOnes = adminUserManagementApis
      .filter((api) => api.authentication?.required === false)
      .map((api) => api.id);
    expect(publicOnes, 'core admin is entirely authenticated').toEqual([]);
  });

  test('every write is global and none is cleared for the live application @framework', () => {
    const wronglyCleared = adminUserManagementApis
      .filter((api) => api.destructive && api.productionSafe)
      .map((api) => api.id);
    expect(wronglyCleared, 'no core-admin write is cleared for live').toEqual([]);
    const mislabeled = adminUserManagementApis
      .filter((api) => api.destructive && api.sideEffect !== 'global')
      .map((api) => ({ id: api.id, sideEffect: api.sideEffect }));
    expect(mislabeled, 'every core-admin write is sideEffect:global (shared company/member state)').toEqual(
      [],
    );
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = adminUserManagementApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
