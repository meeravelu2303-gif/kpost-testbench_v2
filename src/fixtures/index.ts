import { test as base, expect } from '@playwright/test';
import { ApiClient } from '@api/client/api-client';
import { ApiClientPool } from '@api/client/api-client-pool';
import { apiRegistry } from '@api/definitions/index';
import { env } from '@config/env';
import { createDatabaseClient } from '@database/database-client';
import { databaseValidationRegistry } from '@database/validations/index';
import { EndpointExecutor } from '@engine/endpoint-executor';
import { businessRuleFindingReports, flowFindingReports } from '@engine/flow-finding';
import { ValidationEngine, type ValidationEngineDeps } from '@engine/validation-engine';
import { LoginPage } from '@pages/LoginPage';
import { attachValidationReport } from '@reporting/report-attachment';
import { businessRuleRegistry } from '@rules/index';
import { accountPool, type SlotAccounts } from '../test-data/index';
import { newCorrelationId } from '@utils/correlation';
import { createLogger, type Logger } from '@utils/logger';
import { validationRegistry } from '@validators/index';

interface TestFixtures {
  log: Logger;
  /** Ad-hoc client for the default module's base URL. */
  api: ApiClient;
  /** One client per KPost module (core, admin, kmail), created on demand. */
  apiClients: ApiClientPool;
  /** Calls registered endpoints directly (integration tests, setup). */
  endpoints: EndpointExecutor;
  /**
   * The accounts this worker's logical slot owns (Phase 2.3). A spec asks the fixture instead of
   * naming a principal, so two workers can never log in as the same account.
   */
  accounts: SlotAccounts;
  /** Builds an engine; overrides let framework tests swap registries or reporting. */
  createValidationEngine: (overrides?: Partial<ValidationEngineDeps>) => ValidationEngine;
  validationEngine: ValidationEngine;
  loginPage: LoginPage;
}

/** Import `test` and `expect` from `@fixtures` in every spec — never from `@playwright/test`. */
export const test = base.extend<TestFixtures>({
  // eslint-disable-next-line no-empty-pattern
  log: async ({}, use, testInfo) => {
    await use(
      createLogger(testInfo.titlePath.slice(1).join(' > '), undefined, {
        testId: newCorrelationId('test'),
      }),
    );
  },

  api: async ({ playwright, log }, use) => {
    const request = await playwright.request.newContext({ baseURL: env.API_BASE_URL });
    await use(new ApiClient(request, log));
    await request.dispose();
  },

  apiClients: async ({ playwright, log }, use) => {
    const pool = new ApiClientPool(playwright.request, log);
    await use(pool);
    await pool.dispose();
  },

  endpoints: async ({ apiClients, log }, use, testInfo) => {
    const executor = new EndpointExecutor(apiClients, apiRegistry, log);
    await use(executor);
    // After the flow runs, file (a) any server error a gated write hit and (b) any CONFIRMED
    // business-rule violation it detected — otherwise a lifecycle-only bug reaches no developer.
    for (const report of [
      ...flowFindingReports(executor.flowFindings),
      ...businessRuleFindingReports(executor.businessRuleFindings),
    ]) {
      await attachValidationReport(testInfo, report);
    }
  },

  /*
   * Account ownership is positional: the slot is Playwright's `parallelIndex`, which a replacement
   * worker inherits after a crash — unlike `workerIndex`, which would hand a restarted worker a
   * different slice. The pool itself enforces disjointness; this fixture only says which slot.
   */
  // eslint-disable-next-line no-empty-pattern
  accounts: async ({}, use, testInfo) => {
    await use(accountPool.slot(testInfo.parallelIndex));
  },

  createValidationEngine: async ({ apiClients, log, playwright }, use, testInfo) => {
    const dbRequest = await playwright.request.newContext({ baseURL: env.API_BASE_URL });
    await use(
      (overrides = {}) =>
        new ValidationEngine({
          clients: apiClients,
          apiRegistry,
          validators: validationRegistry,
          businessRules: businessRuleRegistry,
          databaseValidations: databaseValidationRegistry,
          database: createDatabaseClient(dbRequest),
          log,
          onReport: (report) => attachValidationReport(testInfo, report),
          ...overrides,
        }),
    );
    await dbRequest.dispose();
  },

  validationEngine: async ({ createValidationEngine }, use) => {
    await use(createValidationEngine());
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
});

export { expect };
