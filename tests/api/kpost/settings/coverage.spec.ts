import { settingsApis, uncoveredSettingsPaths } from '@api/definitions/kpost/settings/index';
import { workbookContract } from '@api/contract/workbook-contract';
import { plannedCases } from '@engine/endpoint-cases';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/**
 * Self-tests for the Settings module. No HTTP — full coverage, contract agreement, and that every
 * write is gated (a settings write changes the account, even if only cosmetically).
 */
test.describe('KPost Settings · module coverage', { tag: '@kpost-api' }, () => {
  test('every documented generalSetting endpoint has a definition @framework', () => {
    expect(uncoveredSettingsPaths(), 'documented but untested').toEqual([]);
  });

  test('every definition matches the generated contract @framework', () => {
    for (const api of settingsApis) {
      const documented = api.contractPath ?? api.path;
      expect(workbookContract('kpost-api', api.method, documented).path, `${api.id} path`).toBe(
        documented,
      );
    }
  });

  test('every Settings endpoint requires a token @framework', () => {
    const publicOnes = settingsApis
      .filter((api) => api.authentication?.required === false)
      .map((api) => api.id);
    expect(publicOnes, 'Settings is entirely authenticated').toEqual([]);
  });

  test('no Settings write is cleared for the live application @framework', () => {
    const cleared = settingsApis
      .filter((api) => api.destructive && api.productionSafe)
      .map((api) => api.id);
    expect(cleared, 'no Settings write is cleared for live').toEqual([]);
  });

  test('every endpoint plans at least 10 validation cases @framework', () => {
    const thin = settingsApis
      .map((api) => ({ id: api.id, cases: plannedCases(resolveEndpoint(api)).length }))
      .filter((entry) => entry.cases < 10);
    expect(thin, 'endpoints with fewer than 10 planned cases').toEqual([]);
  });
});
