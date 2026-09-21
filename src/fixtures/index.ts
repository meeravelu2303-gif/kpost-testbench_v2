import { test as base, expect } from '@playwright/test';
import { ApiClient } from '@api/client/api-client';
import { ApiClientPool } from '@api/client/api-client-pool';
import { apiRegistry } from '@api/definitions/index';
import { env } from '@config/env';
import { DatabasePool } from '@database/database-pool';
import { databaseValidationRegistry } from '@database/validations/index';
import { EndpointExecutor } from '@engine/endpoint-executor';
import { businessRuleFindingReports, flowFindingReports } from '@engine/flow-finding';
import { ValidationEngine, type ValidationEngineDeps } from '@engine/validation-engine';
import { LoginPage } from '@pages/LoginPage';
import { attachValidationReport } from '@reporting/report-attachment';
import { businessRuleRegistry } from '@rules/index';
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
   * One database client per suite, for workflow specs that assert persistence directly.
   *
   * A multi-step flow has to check the database *between* steps — send, then confirm the row, then
   * recall, then confirm the flag — which is not something an endpoint's `database: { validations }`
   * can express, since those run once per endpoint call. The write policy still comes from the
   * target: `databases.for('admin-api')` is read-only whatever the environment says.
   */
  databases: DatabasePool;
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

  databases: async ({ playwright }, use) => {
    // Its own request context: the mock adapter reads the mock's store over HTTP, and a workflow
    // spec must be able to query between steps without borrowing the engine's lifecycle.
    const request = await playwright.request.newContext({ baseURL: env.API_BASE_URL });
    const pool = new DatabasePool(request);
    await use(pool);
    await pool.dispose();
    await request.dispose();
  },

  createValidationEngine: async ({ apiClients, log, playwright }, use, testInfo) => {
    const dbRequest = await playwright.request.newContext({ baseURL: env.API_BASE_URL });
    /*
     * One pool per test, built here rather than inside the factory: the MySQL adapter owns
     * connection pools, and building one per `createValidationEngine()` call would leave a pool
     * open for every engine a framework test constructs. The pool itself creates a client per
     * suite lazily, so a run that never touches Admin never opens its (live) database.
     */
    const databases = new DatabasePool(dbRequest);
    await use(
      (overrides = {}) =>
        new ValidationEngine({
          clients: apiClients,
          apiRegistry,
          validators: validationRegistry,
          businessRules: businessRuleRegistry,
          databaseValidations: databaseValidationRegistry,
          databases,
          log,
          onReport: (report) => attachValidationReport(testInfo, report),
          ...overrides,
        }),
    );
    // Closes pooled connections; a no-op on the mock and disabled adapters, which hold none.
    await databases.dispose();
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
