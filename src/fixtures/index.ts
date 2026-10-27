import { test as base, expect } from '@playwright/test';
import { ApiClient } from '@api/client/api-client';
import { ApiClientPool } from '@api/client/api-client-pool';
import { apiRegistry } from '@api/definitions/index';
import { env } from '@config/env';
import { isLiveHost, testCounterpart } from '@config/live-hosts';
import { DatabasePool } from '@database/database-pool';
import { databaseValidationRegistry } from '@database/validations/index';
import { EndpointExecutor } from '@engine/endpoint-executor';
import { businessRuleFindingReports, flowFindingReports } from '@engine/flow-finding';
import { ValidationEngine, type ValidationEngineDeps } from '@engine/validation-engine';
import { AdminPage } from '@pages/AdminPage';
import { HomePage } from '@pages/HomePage';
import { LoginPage } from '@pages/LoginPage';
import { SettingsPage } from '@pages/SettingsPage';
import { SignupPage } from '@pages/SignupPage';
import { attachValidationReport } from '@reporting/report-attachment';
import { startRecording, writeDiagnosisIfFailed } from '@ui/failure-diagnostics';
import { businessRuleRegistry } from '@rules/index';
import { newCorrelationId } from '@utils/correlation';
import { createLogger, type Logger } from '@utils/logger';
import { loginBlockedReason } from './login-gate';
import { validationRegistry } from '@validators/index';

interface TestFixtures {
  /** Skips (BLOCKED) a test whose saved session is from a login that failed this run. */
  loginGate: void;
  log: Logger;
  /** Ad-hoc client for the default module's base URL. */
  api: ApiClient;
  /** One client per KPost module (core, admin, kmail), created on demand. */
  apiClients: ApiClientPool;
  /** Calls registered endpoints directly (integration tests, setup). */
  endpoints: EndpointExecutor;
  /** One database client per suite, for workflow specs that check persistence between steps. */
  databases: DatabasePool;
  /** Builds an engine; overrides let framework tests swap registries or reporting. */
  createValidationEngine: (overrides?: Partial<ValidationEngineDeps>) => ValidationEngine;
  validationEngine: ValidationEngine;
  loginPage: LoginPage;
  signupPage: SignupPage;
  homePage: HomePage;
  settingsPage: SettingsPage;
  adminPage: AdminPage;
}

/** Import `test` and `expect` from `@fixtures` in every spec — never from `@playwright/test`. */
export const test = base.extend<TestFixtures>({
  // Only a real blocker may stop a test: a failed login stops just the tests that use its session.
  loginGate: [
    async ({ storageState }, use, testInfo) => {
      const reason =
        typeof storageState === 'string' ? loginBlockedReason(storageState) : undefined;
      testInfo.skip(reason !== undefined, `BLOCKED: ${reason}`);
      await use();
    },
    { auto: true },
  ],

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
    // In a browser project, API calls reuse the browser's session (an API login would sign it out).
    const executor = new EndpointExecutor(apiClients, apiRegistry, log, {
      shareBrowserSessions: ['chromium', 'firefox', 'webkit'].includes(testInfo.project.name),
    });
    await use(executor);
    // File any server error a gated flow hit and any confirmed business-rule violation.
    for (const report of [
      ...flowFindingReports(executor.flowFindings),
      ...businessRuleFindingReports(executor.businessRuleFindings),
    ]) {
      await attachValidationReport(testInfo, report);
    }
  },

  // Its own pool, so a workflow spec can query between steps without borrowing the engine's lifecycle.
  // eslint-disable-next-line no-empty-pattern
  databases: async ({}, use) => {
    const pool = new DatabasePool();
    await use(pool);
    await pool.dispose();
  },

  createValidationEngine: async ({ apiClients, log }, use, testInfo) => {
    // One pool per test; clients open lazily, so Admin's live DB opens only when used.
    const databases = new DatabasePool();
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
    // Closes pooled connections; a no-op on the disabled adapter, which holds none.
    await databases.dispose();
  },

  validationEngine: async ({ createValidationEngine }, use) => {
    await use(createValidationEngine());
  },

  // Records a failure diagnosis on every browser page (see @ui/failure-diagnostics).
  page: async ({ page }, use, testInfo) => {
    // No browser request reaches a live host: the live KPost API goes to testingapi, others abort.
    await page.context().route(
      (url) => isLiveHost(url.hostname),
      async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const testApi = testCounterpart(url.hostname);
        if (testApi) {
          const target = `${testApi.origin}${url.pathname}${url.search}`;
          testInfo.annotations.push({
            type: 'redirected to test API',
            description: `${req.method()} ${url.origin}${url.pathname} → ${testApi.origin}`,
          });
          await route.continue({ url: target });
          return;
        }
        testInfo.annotations.push({
          type: 'blocked live request',
          description: `${req.method()} ${url.origin}${url.pathname}`,
        });
        await route.abort('blockedbyclient');
      },
    );
    const recording = await startRecording(page);
    await use(page);
    await writeDiagnosisIfFailed(page, recording, testInfo).catch(() => undefined);
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  signupPage: async ({ page }, use) => {
    await use(new SignupPage(page));
  },

  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },

  settingsPage: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },

  adminPage: async ({ page }, use) => {
    await use(new AdminPage(page));
  },
});

export { expect };
