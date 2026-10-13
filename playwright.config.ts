import { defineConfig, devices, type Project } from '@playwright/test';
import { STORAGE_STATE, STORAGE_STATE_ADMIN, TAGS, TIMEOUTS } from './src/config/constants';
import { env } from './src/config/env';

const BUGZILLA_REPORTER = './src/reporting/bugzilla-reporter.ts';

/**
 * The KPost test bench runs against a LOW-CAPACITY shared server. Workers are hard-capped at 2 and
 * default to 1, enforced here (not only in npm scripts) so no invocation can overload the server.
 * `WORKERS` may lower it to 1 but can never raise it past 2.
 */
const WORKERS_CAP = 2;
const resolveWorkers = (): number => Math.min(Math.max(1, env.WORKERS ?? 1), WORKERS_CAP);

/** One retry everywhere: absorbs a single transient blip without masking a repeatable failure. */
const RETRIES = env.RETRIES ?? 1;

/** UI projects reuse the session saved by the `setup` project. */
const browserProject = (
  name: string,
  device: Project['use'],
  extraUse: Project['use'] = {},
): Project => ({
  name,
  testDir: './tests/e2e',
  use: { ...device, storageState: STORAGE_STATE, ...extraUse },
  dependencies: ['setup'],
  retries: RETRIES,
});

/**
 * Chromium needs fake media so Kall (voice/video) can reach ringing/connecting without a real
 * camera or microphone, with the permissions pre-granted. Harmless for non-media tests. Firefox and
 * WebKit are not used for smoke/sanity (and only Chromium has the fake-device flags), so Kall media
 * flows run on Chromium.
 */
const CHROMIUM_MEDIA: Project['use'] = {
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['camera', 'microphone'],
};

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  timeout: TIMEOUTS.test,
  expect: { timeout: TIMEOUTS.expect },

  // Kept true (pre-existing); with workers defaulting to 1 the run is effectively serial, which is
  // what the low-capacity server needs. The hard worker cap below is the real throughput guard.
  fullyParallel: true,
  forbidOnly: env.CI,
  retries: RETRIES,
  workers: resolveWorkers(),

  // Never run data-mutating tests against production unless explicitly allowed.
  grepInvert:
    env.IS_PRODUCTION && !env.ALLOW_DESTRUCTIVE_TESTS ? new RegExp(TAGS.destructive) : undefined,

  // One run, one report: the Bugzilla reporter writes reports/REPORT.{md,json} (execution health +
  // bugs) and files once from the complete run. Every run is a single serial process on this
  // machine (see docs/guides/commands.md), so there is nothing to shard or merge.
  reporter: [['list'], ['html', { open: 'never' }], [BUGZILLA_REPORTER]],

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
      retries: RETRIES,
    },
    browserProject('chromium', devices['Desktop Chrome'], CHROMIUM_MEDIA),
    browserProject('firefox', devices['Desktop Firefox']),
    browserProject('webkit', devices['Desktop Safari']),
    // The Admin/HR-Setup UI is a SEPARATE SPA (kpostadmin.kpostindia.com) on its own origin, SSO'd
    // by the session `auth-admin.setup.ts` seeds. Its own baseURL + storageState + testDir keep it
    // out of the main-app browser glob; it self-skips unless ADMIN_UI_LIFECYCLE seeds a real session.
    {
      name: 'admin-ui',
      testDir: './tests/e2e-admin',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: env.ADMIN_UI_BASE_URL,
        storageState: STORAGE_STATE_ADMIN,
      },
      dependencies: ['setup'],
      retries: RETRIES,
    },
    { name: 'api', testDir: './tests/api' },
    { name: 'framework', testDir: './tests/framework' },
  ],
});
