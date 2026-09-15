import { defineConfig, devices, type Project } from '@playwright/test';
import { STORAGE_STATE, TAGS, TIMEOUTS } from './src/config/constants';
import { env } from './src/config/env';

const VALIDATION_REPORTER = './src/reporting/validation-reporter.ts';
const BUGZILLA_REPORTER = './src/reporting/bugzilla-reporter.ts';
const MOCK_API_STARTUP_TIMEOUT_MS = 30_000;

/** UI projects reuse the session saved by the `setup` project. */
const browserProject = (name: string, device: Project['use']): Project => ({
  name,
  testDir: './tests/e2e',
  use: { ...device, storageState: STORAGE_STATE },
  dependencies: ['setup'],
  // A live SPA over a throttling third-party host is inherently flakier than an API call: a slow
  // navigation or a transient render can fail one test per full run, rotating between engines. Two
  // retries absorb that intermittent variance without masking a real, repeatable failure (a genuine
  // break fails all three attempts).
  retries: env.RETRIES ?? 2,
});

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  timeout: TIMEOUTS.test,
  expect: { timeout: TIMEOUTS.expect },

  fullyParallel: true,
  forbidOnly: env.CI,
  retries: env.RETRIES ?? (env.CI ? 2 : 0),
  workers: env.WORKERS ?? (env.CI ? '50%' : undefined),

  // Never run data-mutating tests against production unless explicitly allowed.
  grepInvert:
    env.IS_PRODUCTION && !env.ALLOW_DESTRUCTIVE_TESTS ? new RegExp(TAGS.destructive) : undefined,

  // CI emits blob reports so sharded runs can be merged (see merge.config.ts).
  // In CI the shards only produce blobs; bugs are filed once from the merged report
  // (merge.config.ts), so two shards can never file the same defect twice.
  reporter: env.CI
    ? [['blob'], ['github'], ['list'], [VALIDATION_REPORTER]]
    : [['list'], ['html', { open: 'never' }], [VALIDATION_REPORTER], [BUGZILLA_REPORTER]],

  // Local stand-in for the KPost API (MOCK_API=true, the default for TEST_ENV=local).
  webServer: env.MOCK_API
    ? {
        command: 'node mock-server/server.ts',
        url: `${env.API_BASE_URL}/health`,
        reuseExistingServer: !env.CI,
        timeout: MOCK_API_STARTUP_TIMEOUT_MS,
        env: { MOCK_API_PORT: String(env.MOCK_API_PORT) },
        stdout: 'ignore',
        stderr: 'pipe',
      }
    : undefined,

  use: {
    baseURL: env.BASE_URL,
    headless: env.HEADLESS,
    actionTimeout: TIMEOUTS.action,
    navigationTimeout: TIMEOUTS.navigation,
    testIdAttribute: 'data-testid',
    trace: env.CI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // The login setup navigates the live SPA, which occasionally answers a transient
    // ERR_CONNECTION_RESET; retries absorb that so one flaky navigation does not collapse the run
    // (a genuine credential/route failure still fails all attempts).
    {
      name: 'setup',
      testDir: './tests/setup',
      testMatch: /.*\.setup\.ts/,
      retries: env.RETRIES ?? 2,
    },
    browserProject('chromium', devices['Desktop Chrome']),
    browserProject('firefox', devices['Desktop Firefox']),
    browserProject('webkit', devices['Desktop Safari']),
    { name: 'api', testDir: './tests/api' },
    { name: 'integration', testDir: './tests/integration' },
    { name: 'framework', testDir: './tests/framework' },
  ],
});
